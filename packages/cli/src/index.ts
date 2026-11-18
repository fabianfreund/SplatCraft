#!/usr/bin/env -S npx tsx
/**
 * SplatCraft headless CLI.
 *
 *   splatcraft new <parentDir> <name>
 *   splatcraft add <projectDir> <files or dirs...> [--link]
 *   splatcraft run <projectDir> [--preset fast|balanced|quality] [--until <step>] [--force <step>] [--set step.param=value ...] [--verbose]
 *   splatcraft plan <projectDir>
 *   splatcraft tools [--install <id>]
 *   splatcraft monitor
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifySource,
  PipelineEngine,
  Project,
  Registry,
  resolveParams,
  type EngineEvent,
  type PresetId,
  type SystemSample,
} from '@splatcraft/core';
import { builtinPlugins, defaultPipeline } from '@splatcraft/plugins';
import { defaultToolsDir, Toolchain } from '@splatcraft/toolchain';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PRESETS: PresetId[] = ['fast', 'balanced', 'quality'];
/** `pnpm --filter … start` runs in packages/cli; resolve user paths against the caller's cwd. */
const CWD = process.env.INIT_CWD ?? process.cwd();
const abs = (p: string) => path.resolve(CWD, p);

/* ---------------- arg parsing ---------------- */

interface Args {
  _: string[];
  flags: Map<string, string[]>;
}

const BOOL_FLAGS = new Set(['link', 'verbose', 'help', 'json']);

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split(/=(.*)/s, 2);
      const v = inline ?? (BOOL_FLAGS.has(k) ? 'true' : argv[++i]);
      if (v === undefined) die(`Missing value for --${k}`);
      out.flags.set(k, [...(out.flags.get(k) ?? []), v]);
    } else out._.push(a);
  }
  return out;
}

const flag = (a: Args, k: string) => a.flags.get(k)?.at(-1);
const flags = (a: Args, k: string) => a.flags.get(k) ?? [];

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

/* ---------------- setup ---------------- */

async function setup() {
  const registry = new Registry();
  for (const p of builtinPlugins) await registry.load(p);
  const managedDir = defaultToolsDir();
  const toolchain = new Toolchain(registry, { managedDir });
  const engine = new PipelineEngine(registry, toolchain);
  return { registry, toolchain, engine, managedDir };
}

/* ---------------- output helpers ---------------- */

const tty = process.stdout.isTTY;
const c = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = c(2);
const green = c(32);
const red = c(31);
const yellow = c(33);
const cyan = c(36);
const bold = c(1);

function fmtMs(ms: number) {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${Math.round(s % 60).toString().padStart(2, '0')}s`;
}

function fmtStats(stats?: Record<string, number | string>) {
  if (!stats) return '';
  return Object.entries(stats)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}

function bar(f: number, width = 24) {
  const n = Math.round(Math.max(0, Math.min(1, f)) * width);
  return '█'.repeat(n) + '░'.repeat(width - n);
}

class Printer {
  private progressLine = '';
  private lastProgressPrint = 0;
  private imageCounts = new Map<string, number>();
  private lastPreviewPrint = new Map<string, number>();
  private lastMetricPrint = new Map<string, number>();
  private lastPsnrStep = new Map<string, number>();
  private metricsAgg = new Map<string, { step: number; values: Record<string, number> }>();
  counts = { previews: {} as Record<string, number>, metrics: 0 };
  timings: Record<string, number> = {};

  constructor(private verbose: boolean) {}

  private clear() {
    if (tty && this.progressLine) {
      process.stdout.write('\r\x1b[2K');
      this.progressLine = '';
    }
  }

  line(s: string) {
    this.clear();
    console.log(s);
  }

  handle(e: EngineEvent) {
    switch (e.type) {
      case 'run.start':
        this.line(bold(`Run ${e.runId}`) + dim(`  steps: ${e.steps.map((s) => s.key).join(' → ')}`));
        break;
      case 'stage.cached':
        this.line(`${green('✓')} ${pad(e.key)} ${dim('cached')} ${dim(e.hash)}  ${dim(fmtStats(e.stats))}`);
        break;
      case 'stage.start':
        this.line(`${cyan('▶')} ${pad(e.key)} ${e.stageId} ${dim(e.hash)}${e.resume ? yellow(' (resume)') : ''}`);
        break;
      case 'stage.progress': {
        const msg = `  ${pad(e.key)} ${e.fraction !== undefined ? bar(e.fraction) + ' ' + String(Math.round(e.fraction * 100)).padStart(3) + '%' : ''} ${e.message ?? ''}`;
        if (tty) {
          this.progressLine = msg;
          process.stdout.write('\r\x1b[2K' + msg.slice(0, (process.stdout.columns ?? 120) - 1));
        } else if (Date.now() - this.lastProgressPrint > 5000) {
          this.lastProgressPrint = Date.now();
          console.log(dim(msg));
        }
        break;
      }
      case 'stage.log':
        if (e.level === 'error' || (this.verbose && e.level !== 'debug') || (this.verbose && process.env.SPLATCRAFT_DEBUG)) {
          this.line(`  ${dim(pad(e.key))} ${e.level === 'error' ? red(e.line) : dim(e.line)}`);
        }
        break;
      case 'stage.metric': {
        this.counts.metrics++;
        const agg = this.metricsAgg.get(e.key) ?? { step: 0, values: {} };
        agg.step = Math.max(agg.step, e.step);
        Object.assign(agg.values, e.values);
        this.metricsAgg.set(e.key, agg);
        const important = 'psnr' in e.values && this.lastPsnrStep.get(e.key) !== e.step;
        if (important) this.lastPsnrStep.set(e.key, e.step);
        if (important || Date.now() - (this.lastMetricPrint.get(e.key) ?? 0) > 15000) {
          this.lastMetricPrint.set(e.key, Date.now());
          const vals = Object.entries(agg.values)
            .map(([k, v]) => `${k}=${Number.isInteger(v) ? v : v.toFixed(3)}`)
            .join(' ');
          this.line(`  ${pad(e.key)} ${dim('metric')} step=${agg.step} ${vals}`);
        }
        break;
      }
      case 'stage.preview': {
        const p = e.preview;
        this.counts.previews[p.kind] = (this.counts.previews[p.kind] ?? 0) + 1;
        if (p.kind === 'images') {
          const n = (p.append ? (this.imageCounts.get(e.key) ?? 0) : 0) + p.paths.length;
          this.imageCounts.set(e.key, n);
          if (Date.now() - (this.lastPreviewPrint.get(e.key) ?? 0) > 3000) {
            this.lastPreviewPrint.set(e.key, Date.now());
            this.line(`  ${pad(e.key)} ${dim('preview')} images: ${n}`);
          }
        } else if (p.kind === 'frameScores') {
          const kept = p.items.filter((i) => i.kept).length;
          this.line(`  ${pad(e.key)} ${dim('preview')} frameScores: ${kept}/${p.items.length} kept`);
        } else if (p.kind === 'pointcloud') {
          this.line(`  ${pad(e.key)} ${dim('preview')} pointcloud: ${p.points ?? '?'} points ${dim(p.path)}`);
        } else if (p.kind === 'cameras') {
          this.line(`  ${pad(e.key)} ${dim('preview')} cameras: ${p.cameras.length}`);
        } else if (p.kind === 'splat') {
          this.line(`  ${pad(e.key)} ${dim('preview')} splat step=${p.step ?? '?'} ${dim(path.basename(p.path))}`);
        }
        break;
      }
      case 'stage.done':
        this.timings[e.key] = e.durationMs;
        this.line(`${green('✓')} ${pad(e.key)} done in ${fmtMs(e.durationMs)}  ${fmtStats(e.stats)}`);
        break;
      case 'stage.error':
        this.line(`${red('✗')} ${pad(e.key)} ${red(e.error)}`);
        break;
      case 'stage.notice': {
        const n = e.notice;
        const tag = n.level === 'error' ? red('error') : n.level === 'warning' ? yellow('note ') : dim('note ');
        this.line(`  ${pad(e.key)} ${tag} ${n.title}`);
        if (n.detail) this.line(`  ${pad('')} ${dim('      ' + n.detail)}`);
        if (n.hint) this.line(`  ${pad('')} ${dim('      → ' + n.hint)}`);
        break;
      }
      case 'run.done':
        this.line(
          (e.status === 'completed' ? green('Completed') : e.status === 'cancelled' ? yellow('Cancelled') : red('Failed')) +
            (e.error ? `: ${e.error}` : '') +
            dim(`  (metrics: ${this.counts.metrics}, previews: ${JSON.stringify(this.counts.previews)})`),
        );
        break;
    }
  }
}

function pad(s: string) {
  return s.padEnd(8);
}

/* ---------------- --set parsing ---------------- */

function parseValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  if (/^[[{"]/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch {
      /* fall through */
    }
  }
  return raw;
}

/* ---------------- commands ---------------- */

async function cmdNew(a: Args) {
  const [parentDir, name] = a._;
  if (!parentDir || !name) die('usage: new <parentDir> <name>');
  const preset = (flag(a, 'preset') ?? 'balanced') as PresetId;
  const p = await Project.create({ parentDir: abs(parentDir), name, pipeline: defaultPipeline(preset) });
  console.log(p.dir);
}

async function collectMedia(inputs: string[]): Promise<string[]> {
  const out: string[] = [];
  const walk = async (p: string) => {
    const st = await stat(p);
    if (st.isDirectory()) {
      const names = (await readdir(p)).filter((n) => !n.startsWith('.')).sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
      for (const n of names) await walk(path.join(p, n));
    } else if (st.isFile() && classifySource(p) !== 'other') out.push(p);
  };
  for (const i of inputs) await walk(abs(i));
  return out;
}

async function cmdAdd(a: Args) {
  const [dir, ...inputs] = a._;
  if (!dir || !inputs.length) die('usage: add <projectDir> <files or dirs...> [--link]');
  const project = await Project.open(abs(dir));
  const files = await collectMedia(inputs);
  const added = await project.addSources(files, flag(a, 'link') ? 'link' : 'copy');
  const kinds = added.reduce<Record<string, number>>((m, s) => ((m[s.kind] = (m[s.kind] ?? 0) + 1), m), {});
  console.log(`Added ${added.length} of ${files.length} files ${JSON.stringify(kinds)} (${project.meta.sources.length} total)`);
}

async function cmdRun(a: Args) {
  const [dir] = a._;
  if (!dir) die('usage: run <projectDir> [--preset p] [--until step] [--force step] [--set step.param=value]');
  const { engine, registry } = await setup();
  const project = await Project.open(abs(dir));
  const preset = flag(a, 'preset') as PresetId | undefined;
  if (preset && !PRESETS.includes(preset)) die(`unknown preset ${preset}`);
  const sets = flags(a, 'set');
  if (preset || sets.length) {
    await project.update((m) => {
      if (preset) m.pipeline.preset = preset;
      for (const s of sets) {
        const eq = s.indexOf('=');
        const dot = s.indexOf('.');
        if (eq < 0 || dot < 0 || dot > eq) die(`--set expects step.param=value, got "${s}"`);
        const key = s.slice(0, dot);
        const param = s.slice(dot + 1, eq);
        const step = m.pipeline.steps.find((st) => st.key === key);
        if (!step) die(`unknown step "${key}" (steps: ${m.pipeline.steps.map((st) => st.key).join(', ')})`);
        const raw = s.slice(eq + 1);
        if (raw === '') delete step.params[param];
        else step.params[param] = parseValue(raw);
      }
    });
    // Validate early so typos fail before any work.
    for (const st of project.meta.pipeline.steps) {
      try {
        resolveParams(registry.stage(st.stageId), project.meta.pipeline.preset, st.params);
      } catch (e) {
        die(`invalid params for step "${st.key}": ${(e as Error).message}`);
      }
    }
  }
  const until = flag(a, 'until');
  if (until && !project.meta.pipeline.steps.some((s) => s.key === until)) die(`unknown step "${until}"`);

  const printer = new Printer(!!flag(a, 'verbose'));
  engine.on('event', (e: EngineEvent) => printer.handle(e));
  let interrupts = 0;
  process.on('SIGINT', () => {
    interrupts++;
    if (interrupts === 1) {
      printer.line(yellow('Cancelling… (Ctrl-C again to force quit)'));
      engine.cancel();
    } else process.exit(130);
  });
  const t0 = Date.now();
  const res = await engine.run(project, { untilKey: until, force: flags(a, 'force') });
  printer.line(dim(`Total ${fmtMs(Date.now() - t0)} · preset ${project.meta.pipeline.preset} · run dir ${path.join(project.paths.runs, res.runId)}`));
  process.exitCode = res.status === 'completed' ? 0 : res.status === 'cancelled' ? 130 : 1;
}

async function cmdPlan(a: Args) {
  const [dir] = a._;
  if (!dir) die('usage: plan <projectDir>');
  const { engine, registry } = await setup();
  const project = await Project.open(abs(dir));
  const spec = project.meta.pipeline;
  console.log(bold(`${project.meta.name}`) + dim(`  preset=${spec.preset}  sources=${project.meta.sources.length}`));
  const steps = await engine.plan(project);
  for (const s of steps) {
    const st = spec.steps.find((x) => x.key === s.key)!;
    const params = resolveParams(registry.stage(s.stageId), spec.preset, st.params);
    console.log(`${s.cached ? green('✓ cached') : yellow('• pending')} ${pad(s.key)} ${s.stageId} ${dim(s.hash)}`);
    const overrides = Object.keys(st.params);
    console.log(
      dim(
        '    ' +
          Object.entries(params)
            .map(([k, v]) => `${overrides.includes(k) ? '*' : ''}${k}=${JSON.stringify(v)}`)
            .join(' '),
      ),
    );
  }
  for (const s of spec.steps.filter((x) => !x.enabled)) console.log(dim(`  (disabled) ${s.key} ${s.stageId}`));
}

async function cmdTools(a: Args) {
  const { toolchain, managedDir } = await setup();
  const id = flag(a, 'install');
  if (id) {
    let last = -1;
    const st = await toolchain.install(id, (f, msg) => {
      const pct = Math.round(f * 100);
      if (pct !== last) {
        last = pct;
        process.stdout.write(`\r\x1b[2K${bar(f)} ${pct}% ${msg.slice(0, 80)}`);
      }
    });
    console.log(`\n${st.available ? green('Installed') : red('Not available')} ${st.name} ${st.version ?? ''} ${dim(st.path ?? '')}${st.error ? red(' ' + st.error) : ''}`);
    return;
  }
  console.log(dim(`managed dir: ${managedDir}`));
  for (const st of await toolchain.statusAll(true)) {
    console.log(
      `${st.available ? green('✓') : red('✗')} ${st.id.padEnd(8)} ${(st.version ?? '').padEnd(12)} ${st.source ? dim(`[${st.source}]`) : ''} ${st.path ?? ''}` +
        (st.available ? '' : `  ${yellow(st.installHint ?? (st.installable ? `install with: tools --install ${st.id}` : 'no installer'))}`) +
        (st.error ? red(` ${st.error}`) : ''),
    );
  }
}

async function cmdMonitor(a: Args) {
  const { registry } = await setup();
  const projectDir = a._[0] ? abs(a._[0]) : undefined;
  const providers = [];
  for (const { provider } of registry.monitors.values()) if (await provider.isSupported()) providers.push(provider);
  console.log(dim(`providers: ${providers.map((p) => p.id).join(', ')}`));
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise((r) => setTimeout(r, 1000));
    const t = Date.now();
    const parts = await Promise.all(providers.map((p) => p.sample({ projectDir }).catch(() => ({}) as Partial<SystemSample>)));
    const s: SystemSample = { t, gpus: [] };
    for (const p of parts) {
      const { gpus, ...rest } = p;
      Object.assign(s, rest);
      if (gpus) s.gpus.push(...gpus);
    }
    const took = Date.now() - t;
    const gpu = s.gpus
      .map((g) => `${g.name} ${g.utilization ?? '?'}% ${g.vramUsedMB ?? '?'}/${g.vramTotalMB ?? '?'}MB${g.temperatureC !== undefined ? ` ${g.temperatureC}°C` : ''}${g.powerW !== undefined ? ` ${g.powerW}W` : ''}`)
      .join(', ');
    console.log(
      `CPU ${s.cpu?.utilization ?? '?'}% (${s.cpu?.cores} cores)  RAM ${s.memory?.usedMB}/${s.memory?.totalMB}MB  disk free ${s.disk?.freeMB}MB  GPU ${gpu || '-'}  ${dim(`(${took}ms)`)}`,
    );
    if (flag(a, 'json')) console.log(JSON.stringify(s));
  }
}

function usage() {
  console.log(`SplatCraft CLI

  new <parentDir> <name> [--preset fast|balanced|quality]
  add <projectDir> <files or dirs...> [--link]
  run <projectDir> [--preset p] [--until <step>] [--force <step>] [--set step.param=value ...] [--verbose]
  plan <projectDir>
  tools [--install <id>]
  monitor [projectDir] [--json]

Steps of the default pipeline: frames, quality, align, train, export.
Env: SPLATCRAFT_TOOLS_DIR (managed tools dir, default: per-user app data SplatCraft/tools), SPLATCRAFT_TOOL_<ID>=/path/to/exe`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2).filter((x, i) => !(i === 0 && x === '--'));
  const a = parseArgs(rest);
  switch (cmd) {
    case 'new':
      return cmdNew(a);
    case 'add':
      return cmdAdd(a);
    case 'run':
      return cmdRun(a);
    case 'plan':
      return cmdPlan(a);
    case 'tools':
      return cmdTools(a);
    case 'monitor':
      return cmdMonitor(a);
    default:
      usage();
      if (cmd && cmd !== 'help' && cmd !== '--help') process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(red(`error: ${e instanceof Error ? e.message : String(e)}`));
  process.exit(1);
});
