import { spawn } from 'node:child_process';
import { copyFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { definePlugin, defineStage, type StageContext, type ToolSpec } from '@splatcraft/core';
import { z } from 'zod';
import { abortError, ensureDir, exists, freshDir, linkDir, linkOrCopy, readPlyInfo, shQuote, stripAnsi } from '../util/fs.js';
import { exportStep, parseBrushLine } from './parse.js';

const RELEASE = 'https://github.com/ArthurBrussee/brush/releases/download/v0.3.0';

export const brushTool: ToolSpec = {
  id: 'brush',
  name: 'Brush',
  description: 'Cross-platform Gaussian Splatting trainer (WebGPU: Metal, Vulkan, DX12).',
  license: 'Apache-2.0',
  homepage: 'https://github.com/ArthurBrussee/brush',
  executables: ['brush_app', 'brush'],
  versionArgs: ['--version'],
  parseVersion: (out) => /(\d+\.\d+\.\d+\S*)/.exec(out)?.[1],
  install: {
    'darwin-arm64': {
      type: 'download',
      url: `${RELEASE}/brush-app-aarch64-apple-darwin.tar.xz`,
      sha256: '65b2631398c839be3c1d4d7160fe2326389dec87830aac0710985e6690a1048c',
      archive: 'tar.xz',
      binPath: 'brush-app-aarch64-apple-darwin/brush_app',
    },
    'win32-x64': {
      type: 'download',
      url: `${RELEASE}/brush-app-x86_64-pc-windows-msvc.zip`,
      sha256: 'b68e3e9cf052d51bf3ee30776fa5a364de7f2ba13b58443128ff797bb7bcfcd6',
      archive: 'zip',
      binPath: 'brush_app.exe', // zip has no top-level folder (verified from the archive's central directory)
    },
    'linux-x64': {
      type: 'download',
      url: `${RELEASE}/brush-app-x86_64-unknown-linux-gnu.tar.xz`,
      sha256: '4f0f9a8785d1951c62df26aae247c02c5bba32b00f40b06df4e1c9b867399e20',
      archive: 'tar.xz',
      binPath: 'brush-app-x86_64-unknown-linux-gnu/brush_app',
    },
    'darwin-x64': { type: 'manual', instructions: 'Brush has no Intel macOS build; build it from source with cargo.', url: 'https://github.com/ArthurBrussee/brush' },
  },
};

export const brushParams = z.object({
  totalSteps: z.number().int().min(100).max(1_000_000).default(30000).describe('Total training steps.'),
  exportEvery: z.number().int().min(50).default(1000).describe('Write a snapshot (and update the live preview) every N steps. Also the resume granularity.'),
  maxResolution: z.number().int().min(128).max(8192).default(1920).describe('Longest image side used for training.'),
  maxSplats: z.number().int().min(10_000).max(50_000_000).default(10_000_000).describe('Upper bound on the number of gaussians (controls VRAM use).'),
  shDegree: z.number().int().min(0).max(4).default(3).describe('Spherical-harmonics degree (view-dependent color). 0 = flat color, smaller files.'),
  evalSplitEvery: z.number().int().min(0).default(0).describe('Hold out every Nth image for evaluation (PSNR/SSIM charts). 0 = train on all images.'),
  evalEvery: z.number().int().min(50).default(1000).describe('Evaluate on held-out views every N steps (needs evalSplitEvery > 0).'),
  refineEvery: z.number().int().min(10).default(200).describe('Steps between densification/refinement passes. Roughly the number of images needed to cover the scene.'),
  growthGradThreshold: z.number().min(0).default(0.00004).describe('Gradient threshold for splat growth. Lower = faster growth.'),
  growthSelectFraction: z.number().min(0).max(1).default(0.1).describe('Fraction of candidate splats that actually grow per refinement.'),
  growthStopIter: z.number().int().min(0).default(0).describe('Stop growing splats after this step. 0 = auto (half of totalSteps).'),
  ssimWeight: z.number().min(0).max(1).default(0.2).describe('Weight of the SSIM loss relative to L1.'),
  lpipsWeight: z.number().min(0).max(10).default(0).describe('Weight of the LPIPS perceptual loss (0 = off; slower when on).'),
  seed: z.number().int().min(0).default(42).describe('Random seed.'),
  extraArgs: z.string().default('').describe('Extra command-line arguments passed to brush_app verbatim (space separated).'),
});
export type BrushParams = z.infer<typeof brushParams>;

export const brushStage = defineStage<BrushParams>({
  id: 'splatcraft.train.brush',
  version: '1',
  title: 'Train (Brush)',
  description: 'Trains a Gaussian Splat with Brush on any GPU. Snapshots stream into the viewer while training; interrupted runs resume from the last snapshot.',
  category: 'train',
  paramsSchema: brushParams as z.ZodType<BrushParams>,
  presets: {
    // Short runs need faster growth to reach a useful density before growth stops.
    fast: { totalSteps: 3000, exportEvery: 500, evalEvery: 500, maxResolution: 800, maxSplats: 1_000_000, refineEvery: 100, growthSelectFraction: 0.2 },
    balanced: { totalSteps: 15000, exportEvery: 1000, maxResolution: 1600, maxSplats: 3_000_000 },
    quality: { totalSteps: 30000, exportEvery: 2000, evalEvery: 2000, maxResolution: 2400, maxSplats: 6_000_000 },
  },
  tools: ['brush'],
  inputs: ['dataset'],
  outputs: ['splat'],
  resumable: true,
  async run(ctx) {
    const dataset = ctx.inputs.dataset?.path;
    if (!dataset) throw new Error('No dataset input');
    const p = ctx.params;
    const exportDir = path.join(ctx.workDir, 'exports');
    const t0 = Date.now();

    // ---- Resume: latest complete snapshot becomes the init splat. ----
    let startIter = 0;
    let initPly: string | undefined;
    if (ctx.resume && (await exists(exportDir))) {
      const snaps = await listSnapshots(exportDir);
      for (const s of snaps.filter((s) => !s.complete)) await rm(s.file, { force: true }); // half-written on kill
      const latest = snaps.filter((s) => s.complete).at(-1);
      if (latest) {
        startIter = Math.min(latest.step, p.totalSteps);
        initPly = latest.file;
        ctx.log(`Resuming from snapshot at step ${latest.step}`);
      }
    } else {
      await freshDir(exportDir);
    }

    let source = dataset;
    if (initPly && startIter < p.totalSteps) {
      // Brush picks up any .ply in the dataset folder as initial splat; build a
      // linked copy so the cached dataset stays untouched.
      source = await freshDir(path.join(ctx.workDir, 'resume-dataset'));
      for (const name of await readdir(dataset)) {
        if (name.toLowerCase().endsWith('.ply')) continue;
        const st = await stat(path.join(dataset, name));
        if (st.isDirectory()) await linkDir(path.join(dataset, name), path.join(source, name));
        else await linkOrCopy(path.join(dataset, name), path.join(source, name));
      }
      await copyFile(initPly, path.join(source, 'init.ply'));
    }

    let lastStep = startIter;
    let lastSplats: number | undefined;
    let lastPsnr: number | undefined;
    let lastSsim: number | undefined;
    let lastEvalStep = -1;
    let stepsPerSec: number | undefined;
    let remaining: string | undefined;

    if (startIter < p.totalSteps) {
      const args = [
        source,
        '--total-steps', String(p.totalSteps),
        '--export-every', String(p.exportEvery),
        '--export-path', exportDir,
        '--export-name', 'export_{iter}.ply',
        '--max-resolution', String(p.maxResolution),
        '--max-splats', String(p.maxSplats),
        '--sh-degree', String(p.shDegree),
        '--refine-every', String(p.refineEvery),
        '--growth-grad-threshold', String(p.growthGradThreshold),
        '--growth-select-fraction', String(p.growthSelectFraction),
        '--growth-stop-iter', String(p.growthStopIter || Math.round(p.totalSteps / 2)),
        '--ssim-weight', String(p.ssimWeight),
        '--lpips-loss-weight', String(p.lpipsWeight),
        '--seed', String(p.seed),
      ];
      if (p.evalSplitEvery > 0) args.push('--eval-split-every', String(p.evalSplitEvery), '--eval-every', String(p.evalEvery));
      if (startIter > 0) args.push('--start-iter', String(startIter));
      if (p.extraArgs.trim()) args.push(...p.extraArgs.trim().split(/\s+/));

      // Live preview: watch for new complete snapshots.
      const seen = new Set<string>();
      const sizes = new Map<string, number>();
      const scan = async (final = false) => {
        const snaps = await listSnapshots(exportDir);
        let newest: (typeof snaps)[number] | undefined;
        for (const s of snaps) {
          if (seen.has(s.file) || !s.complete) continue;
          const size = (await stat(s.file).catch(() => undefined))?.size ?? -1;
          if (!final && sizes.get(s.file) !== size) {
            sizes.set(s.file, size); // wait one poll for the size to settle
            continue;
          }
          seen.add(s.file);
          newest = s;
          if (s.vertices) {
            lastSplats = s.vertices;
            ctx.metric(s.step, { splats: s.vertices });
          }
        }
        if (newest) {
          ctx.preview({ kind: 'splat', path: newest.file, step: newest.step });
          // Snapshots can be GBs each: keep only the newest few (resume + in-flight viewer loads).
          await pruneSnapshots(exportDir, KEEP_LIVE_SNAPSHOTS);
          // Without a pty (Windows) snapshots are the main progress signal.
          if (newest.step > lastStep) {
            lastStep = newest.step;
            report();
          }
        }
      };
      // Mark pre-existing snapshots as seen (resume).
      for (const s of await listSnapshots(exportDir)) seen.add(s.file);

      let lastMetricAt = 0;
      const report = () =>
        ctx.progress({
          fraction: lastStep / p.totalSteps,
          message: [
            `Step ${lastStep}/${p.totalSteps}`,
            stepsPerSec ? `${stepsPerSec.toFixed(1)} it/s` : '',
            remaining ? `${remaining} left` : '',
            lastSplats ? `${formatCount(lastSplats)} splats` : '',
            lastPsnr ? `PSNR ${lastPsnr.toFixed(2)}` : '',
          ].filter(Boolean).join(' · '),
        });
      let lastReport = 0;
      const seenLines = new Set<string>();
      const timer = setInterval(() => void scan().catch(() => {}), 1000);
      try {
        // cwd: brush/cubecl keep a GPU autotune cache in ./target — share it across runs.
        const cwd = await ensureDir(path.join(os.tmpdir(), 'splatcraft-brush'));
        await runBrush(ctx, ctx.tools.brush, args, cwd, (line) => {
          const e = parseBrushLine(line);
          if (!e) {
            // The TTY bar re-prints status lines on every redraw: log each distinct line once.
            const key = line.replace(/^\[[^\]]*\]\s*/, '');
            if (!seenLines.has(key) && !/Steps|load_scene_img|Loaded COLMAP image|autotune|Tuning|cubecl|^(?:[\s·•░▓█○◍]|🖌)/u.test(line)) {
              seenLines.add(key);
              ctx.log(line, 'info');
            }
            return;
          }
          const now = Date.now();
          switch (e.type) {
            case 'step':
              lastStep = Math.max(lastStep, e.step);
              stepsPerSec = e.stepsPerSec ?? stepsPerSec;
              remaining = e.remaining;
              if (stepsPerSec && now - lastMetricAt > 2000) {
                lastMetricAt = now;
                ctx.metric(e.step, { stepsPerSec });
              }
              break;
            case 'eval':
              // The TTY bar re-prints the last message on every redraw → de-dupe by step.
              if (e.step <= lastEvalStep) break;
              lastEvalStep = e.step;
              lastPsnr = e.psnr;
              lastSsim = e.ssim;
              lastStep = Math.max(lastStep, e.step);
              ctx.metric(e.step, { psnr: e.psnr, ...(e.ssim !== undefined ? { ssim: e.ssim } : {}) });
              ctx.log(line.replace(/^.*?(Eval iter)/, '$1'));
              break;
            case 'splats':
              if (e.count === lastSplats) break;
              lastSplats = e.count;
              ctx.metric(e.step ?? lastStep, { splats: e.count });
              break;
            case 'loaded':
              if (!seenLines.has('loaded')) ctx.log(`Dataset: ${e.train} training views, ${e.eval} eval views`);
              seenLines.add('loaded');
              break;
          }
          if (now - lastReport > 250) {
            lastReport = now;
            report();
          }
        });
      } finally {
        clearInterval(timer);
      }
      await scan(true);
    }

    const snaps = (await listSnapshots(exportDir)).filter((s) => s.complete);
    const final = snaps.at(-1);
    if (!final) throw new Error('Brush finished without writing a splat');
    if (final.step < p.totalSteps) ctx.log(`Last snapshot is at step ${final.step} (< ${p.totalSteps})`, 'warn');
    const out = path.join(ctx.workDir, 'splat.ply');
    await linkOrCopy(final.file, out);
    await rm(path.join(ctx.workDir, 'resume-dataset'), { recursive: true, force: true });
    await pruneSnapshots(exportDir, 0, final.file); // splat.ply is a hardlink/copy of the final one
    ctx.preview({ kind: 'splat', path: out, step: final.step });
    ctx.progress({ fraction: 1, message: `Done: ${formatCount(final.vertices)} splats` });
    return {
      outputs: { splat: { path: out, meta: { splats: final.vertices, steps: final.step, shDegree: p.shDegree } } },
      stats: {
        steps: final.step,
        splats: final.vertices,
        ...(lastPsnr !== undefined ? { psnr: Number(lastPsnr.toFixed(2)) } : {}),
        ...(lastSsim !== undefined ? { ssim: Number(lastSsim.toFixed(4)) } : {}),
        ...(startIter > 0 ? { resumedFrom: startIter } : {}),
        durationSec: Math.round((Date.now() - t0) / 1000),
        sizeMB: Number(((await stat(out)).size / 1e6).toFixed(1)),
      },
    };
  },
});

const KEEP_LIVE_SNAPSHOTS = 3;

async function pruneSnapshots(dir: string, keep: number, alsoKeep?: string) {
  const complete = (await listSnapshots(dir)).filter((s) => s.complete);
  const doomed = complete.slice(0, Math.max(0, complete.length - keep)).filter((s) => s.file !== alsoKeep);
  await Promise.all(doomed.map((s) => rm(s.file, { force: true })));
}

async function listSnapshots(dir: string) {
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: { file: string; step: number; vertices: number; complete: boolean }[] = [];
  for (const n of names) {
    const step = exportStep(n);
    if (step === undefined) continue;
    const file = path.join(dir, n);
    const info = await readPlyInfo(file);
    out.push({ file, step, vertices: info?.vertices ?? 0, complete: !!info?.complete });
  }
  return out.sort((a, b) => a.step - b.step);
}

function formatCount(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n);
}

/**
 * Run brush_app. Brush only prints step progress when stdout is a TTY, so on
 * macOS/Linux we wrap it in `script` (a pseudo-terminal) — no native deps.
 * Set SPLATCRAFT_BRUSH_NO_PTY=1 to disable. RUST_LOG gives eval/refine lines
 * either way.
 */
function runBrush(ctx: StageContext<BrushParams>, exe: string, args: string[], cwd: string, onLine: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ctx.signal.aborted) return reject(abortError());
    const usePty = process.platform !== 'win32' && !process.env.SPLATCRAFT_BRUSH_NO_PTY;
    let cmd = exe;
    let argv = args;
    if (usePty && process.platform === 'darwin') {
      cmd = '/usr/bin/script';
      argv = ['-q', '/dev/null', exe, ...args];
    } else if (usePty) {
      cmd = 'script';
      argv = ['-qfec', [exe, ...args].map(shQuote).join(' '), '/dev/null'];
    }
    ctx.log(`$ ${[exe, ...args].map(shQuote).join(' ')}`, 'debug');
    const child = spawn(cmd, argv, {
      cwd,
      // Under a pty the bar already shows evals/splat counts; RUST_LOG would interleave with it.
      env: usePty
        ? { ...process.env, COLUMNS: '160', TERM: 'xterm-256color' }
        : { ...process.env, RUST_LOG: process.env.RUST_LOG ?? 'brush_cli=info,brush_process=warn' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onAbort = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 3000).unref();
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    const tail: string[] = [];
    const wire = (stream: NodeJS.ReadableStream) => {
      let buf = '';
      stream.setEncoding('utf8');
      const emit = (raw: string) => {
        const line = stripAnsi(raw).replace(/^\^D/, '').trim();
        if (!line) return;
        tail.push(line);
        if (tail.length > 30) tail.shift();
        onLine(line);
      };
      stream.on('data', (chunk: string) => {
        buf += chunk;
        const parts = buf.split(/\r\n|\r|\n/);
        buf = parts.pop() ?? '';
        for (const l of parts) emit(l);
      });
      stream.on('end', () => buf && emit(buf));
    };
    wire(child.stdout!);
    wire(child.stderr!);
    child.on('error', (e) => {
      ctx.signal.removeEventListener('abort', onAbort);
      reject(e);
    });
    child.on('close', (code, sig) => {
      ctx.signal.removeEventListener('abort', onAbort);
      if (ctx.signal.aborted) return reject(abortError());
      if (code !== 0) {
        for (const l of tail.slice(-10)) ctx.log(l, 'error');
        return reject(new Error(`brush_app exited with ${code ?? sig}`));
      }
      resolve();
    });
  });
}

export const brushPlugin = definePlugin({
  id: 'splatcraft.brush',
  name: 'Brush trainer',
  version: '0.1.0',
  description: 'Gaussian Splat training with Brush (WebGPU, every GPU vendor).',
  register(api) {
    api.registerTool(brushTool);
    api.registerStage(brushStage);
  },
});

