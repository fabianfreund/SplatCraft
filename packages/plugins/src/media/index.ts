import { mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { definePlugin, defineStage, type SourceEntry, type StageContext, type ToolSpec } from '@splatcraft/core';
import sharp from 'sharp';
import { z } from 'zod';
import { execText, freshDir, pool, sleep, throwIfAborted } from '../util/fs.js';
import { analyzeImage } from '../util/image.js';
import { ImagePreviewBatcher, throttledProgress } from '../util/preview.js';

const ffVersion = (out: string) => /version\s+(\S+)/.exec(out)?.[1];

export const ffmpegTool: ToolSpec = {
  id: 'ffmpeg',
  name: 'FFmpeg',
  description: 'Video decoding and frame extraction.',
  license: 'LGPL/GPL',
  homepage: 'https://ffmpeg.org',
  executables: ['ffmpeg'],
  versionArgs: ['-version'],
  parseVersion: ffVersion,
  install: {
    'darwin-arm64': { type: 'brew', formula: 'ffmpeg' },
    'darwin-x64': { type: 'brew', formula: 'ffmpeg' },
    'win32-x64': { type: 'manual', instructions: 'Install FFmpeg (e.g. `winget install Gyan.FFmpeg`) and make sure ffmpeg.exe is on PATH.', url: 'https://www.gyan.dev/ffmpeg/builds/' },
    'linux-x64': { type: 'manual', instructions: 'Install FFmpeg with your package manager, e.g. `sudo apt install ffmpeg`.' },
    'linux-arm64': { type: 'manual', instructions: 'Install FFmpeg with your package manager, e.g. `sudo apt install ffmpeg`.' },
  },
};

export const ffprobeTool: ToolSpec = {
  ...ffmpegTool,
  id: 'ffprobe',
  name: 'FFprobe',
  description: 'Reads video metadata (duration, frame rate, rotation).',
  executables: ['ffprobe'],
};

export const framesParams = z.object({
  maxResolution: z.number().int().min(256).max(8192).default(1600).describe('Longest image side in pixels after resizing (originals are never upscaled).'),
  fps: z.number().min(0.1).max(60).default(2).describe('Frames per second to extract from videos.'),
  sharpestOf: z.number().int().min(1).max(8).default(3).describe('Videos: decode this many candidates per kept frame and keep the sharpest one (1 = off).'),
  jpegQuality: z.number().int().min(50).max(100).default(92).describe('JPEG quality of the normalized frames.'),
  maxFramesPerVideo: z.number().int().min(0).default(0).describe('Upper limit of frames per video (0 = unlimited).'),
});
export type FramesParams = z.infer<typeof framesParams>;

type Entry = SourceEntry & { abs: string };

export const framesStage = defineStage<FramesParams>({
  id: 'splatcraft.prepare.frames',
  // Unchanged output without a trim, which enters the cache key on their own.
  version: '1',
  title: 'Frames',
  description: 'Normalizes photos (EXIF rotation, resize, JPEG; camera EXIF kept) and extracts sharp frames from videos.',
  category: 'prepare',
  paramsSchema: framesParams as z.ZodType<FramesParams>,
  presets: {
    fast: { maxResolution: 1000, fps: 2, sharpestOf: 2 },
    balanced: { maxResolution: 1600, fps: 2, sharpestOf: 3 },
    quality: { maxResolution: 2400, fps: 3, sharpestOf: 4 },
  },
  tools: [],
  optionalTools: ['ffmpeg', 'ffprobe'],
  inputs: ['sources'],
  outputs: ['frames'],
  async run(ctx) {
    const entries = ((ctx.inputs.sources?.meta?.entries ?? []) as Entry[]).filter((e) => e.kind === 'image' || e.kind === 'video');
    if (!entries.length) throw new Error('No photos or videos in the project — add media first.');
    const framesDir = await freshDir(path.join(ctx.workDir, 'frames'));
    const images = entries.filter((e) => e.kind === 'image');
    const videos = entries.filter((e) => e.kind === 'video');
    if (videos.length && !ctx.tools.ffmpeg) throw new Error('FFmpeg is required to extract frames from videos. Install it from the Tools screen.');

    const preview = new ImagePreviewBatcher(ctx);
    const progress = throttledProgress(ctx);
    const names = new Set<string>();
    const uniqueName = (stem: string) => {
      const base = stem.replace(/[^\w.-]+/g, '_') || 'frame';
      let n = base;
      for (let i = 2; names.has(n.toLowerCase()); i++) n = `${base}_${i}`;
      names.add(n.toLowerCase());
      return n + '.jpg';
    };

    // Work units for progress: one per image, expected frame count per video.
    const videoInfo = await Promise.all(videos.map(async (v) => withTrim(await probeVideo(ctx, v.abs), v)));
    const videoUnits = videoInfo.map((i) => Math.max(1, Math.round((i.span ?? 10) * ctx.params.fps)));
    const totalUnits = images.length + videoUnits.reduce((a, b) => a + b, 0);
    let doneUnits = 0;

    let imageCount = 0;
    let failed = 0;
    await pool(images, Math.max(2, Math.min(8, os.cpus().length - 1)), async (e) => {
      const out = path.join(framesDir, uniqueName(path.parse(e.name).name));
      try {
        await normalizeImage(ctx, e.abs, out);
        imageCount++;
        preview.add(out);
      } catch (err) {
        failed++;
        ctx.log(`Skipping ${e.name}: ${(err as Error).message}`, 'warn');
      }
      doneUnits++;
      progress(doneUnits / totalUnits, `Photos ${doneUnits}/${images.length}`);
    }, ctx.signal);
    preview.flush();

    let videoFrames = 0;
    for (const [vi, v] of videos.entries()) {
      throwIfAborted(ctx.signal);
      const base = doneUnits;
      const n = await extractVideo(ctx, v, videoInfo[vi], framesDir, uniqueName, (p) => preview.add(p), (frac, msg) =>
        progress((base + frac * videoUnits[vi]) / totalUnits, msg),
      );
      doneUnits = base + videoUnits[vi];
      videoFrames += n;
      preview.flush();
    }

    await rm(path.join(ctx.workDir, 'tmp'), { recursive: true, force: true });
    const count = imageCount + videoFrames;
    if (!count) throw new Error('No frames could be produced from the sources.');
    progress(1, `${count} frames`, true);
    return {
      outputs: { frames: { path: framesDir, meta: { count } } },
      stats: { frames: count, fromPhotos: imageCount, fromVideos: videoFrames, videos: videos.length, ...(failed ? { unreadable: failed } : {}) },
    };
  },
});

async function normalizeImage(ctx: StageContext<FramesParams>, src: string, out: string) {
  const max = ctx.params.maxResolution;
  const write = (input: string) =>
    sharp(input, { failOn: 'none' })
      .rotate()
      .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
      // Keep EXIF (camera, lens, focal length): alignment uses it to group cameras and as a focal prior.
      // rotate() already applied the orientation, and sharp resets the tag to normal.
      .keepExif()
      .jpeg({ quality: ctx.params.jpegQuality, mozjpeg: false })
      .toFile(out);
  try {
    await write(src);
  } catch (err) {
    // sharp's prebuilt libvips can't decode HEIC/DNG: convert with a system tool first.
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'sc-img-'));
    const conv = path.join(tmp, 'conv.png');
    try {
      if (process.platform === 'darwin') await execText('sips', ['-s', 'format', 'png', src, '--out', conv], 60000);
      else if (ctx.tools.ffmpeg) await execText(ctx.tools.ffmpeg, ['-y', '-v', 'error', '-i', src, conv], 60000);
      else throw err;
      await write(conv);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
}

interface ProbeInfo {
  duration?: number;
  fps?: number;
}

/** Probe data plus the part of the clip to extract (from the source's trim). */
interface VideoInfo extends ProbeInfo {
  /** Seconds to skip at the start. */
  start: number;
  /** Seconds to extract after `start`; undefined = until the end. */
  length?: number;
  /** Duration of the extracted part when known (for progress and frame budgets). */
  span?: number;
}

export function withTrim(info: ProbeInfo, v: Pick<SourceEntry, 'trim'>): VideoInfo {
  const d = info.duration;
  let start = Math.max(0, v.trim?.start ?? 0);
  let end = v.trim?.end;
  if (d !== undefined) {
    if (start >= d) start = 0; // a trim past the end (e.g. replaced file) → ignore it
    if (end !== undefined && end > d) end = undefined;
  }
  if (end !== undefined && end <= start) end = undefined;
  const length = end !== undefined ? end - start : undefined;
  const span = length ?? (d !== undefined ? d - start : undefined);
  return { ...info, start, length, span };
}

async function probeVideo(ctx: StageContext<FramesParams>, file: string): Promise<ProbeInfo> {
  if (!ctx.tools.ffprobe) return {};
  try {
    const out = await execText(ctx.tools.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate:format=duration', '-of', 'json', file], 20000);
    const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    const [a, b] = String(j.streams?.[0]?.avg_frame_rate ?? '0/1').split('/').map(Number);
    return { duration: Number(j.format?.duration) || undefined, fps: b ? a / b : undefined };
  } catch {
    return {};
  }
}

/**
 * Extract `fps × sharpestOf` candidates into a temp dir with ffmpeg and keep
 * the sharpest of each window of `sharpestOf` consecutive candidates. Windows
 * are processed while ffmpeg is still running, so thumbnails stream in.
 */
async function extractVideo(
  ctx: StageContext<FramesParams>,
  v: Entry,
  info: VideoInfo,
  framesDir: string,
  uniqueName: (stem: string) => string,
  onFrame: (p: string) => void,
  onProgress: (fraction: number, message: string) => void,
): Promise<number> {
  const { sharpestOf, maxResolution: M, maxFramesPerVideo } = ctx.params;
  let fps = ctx.params.fps;
  // Spread a frame budget evenly over the whole (trimmed) clip instead of truncating it.
  if (maxFramesPerVideo > 0 && info.span && info.span * fps > maxFramesPerVideo) fps = maxFramesPerVideo / info.span;
  const k = Math.max(1, sharpestOf);
  const candFps = info.fps ? Math.min(fps * k, info.fps) : fps * k;
  const window = Math.max(1, Math.round(candFps / fps));
  const tmp = await freshDir(path.join(ctx.workDir, 'tmp', v.id));
  const stem = path.parse(v.name).name;
  const scale = `scale='if(gte(iw,ih),min(iw,${M}),-2)':'if(gte(iw,ih),-2,min(ih,${M}))':flags=lanczos`;
  // Input seeking (-ss before -i) is fast and frame-accurate when re-encoding.
  const range = [...(info.start > 0 ? ['-ss', info.start.toFixed(3)] : []), ...(info.length !== undefined ? ['-t', info.length.toFixed(3)] : [])];
  const args = ['-hide_banner', '-nostdin', '-y', ...range, '-i', v.abs, '-vf', `fps=${candFps},${scale}`, '-q:v', '2', '-progress', 'pipe:1', '-nostats', '-stats_period', '1'];
  if (maxFramesPerVideo > 0) args.push('-frames:v', String(maxFramesPerVideo * window + window - 1));
  args.push(path.join(tmp, '%06d.jpg'));

  let kept = 0;
  let nextWindow = 0;
  let ffmpegDone = false;
  let outTime = 0;
  const processWindows = async () => {
    const files = (await readdir(tmp)).filter((f) => f.endsWith('.jpg')).sort();
    // While ffmpeg runs, the newest file may be half-written → only take full windows followed by ≥1 file.
    while ((nextWindow + 1) * window < files.length || (ffmpegDone && nextWindow * window < files.length)) {
      const group = files.slice(nextWindow * window, (nextWindow + 1) * window).map((f) => path.join(tmp, f));
      let best = group[0];
      if (group.length > 1) {
        let bestScore = -1;
        for (const f of group) {
          const s = (await analyzeImage(f, 384).catch(() => ({ sharpness: -1 }))).sharpness;
          if (s > bestScore) [bestScore, best] = [s, f];
        }
      }
      const out = path.join(framesDir, uniqueName(`${stem}_${String(nextWindow + 1).padStart(5, '0')}`));
      await rename(best, out);
      for (const f of group) if (f !== best) await rm(f, { force: true });
      onFrame(out);
      kept++;
      nextWindow++;
    }
  };

  const run = ctx.spawn('ffmpeg', args, {
    onLine: (line) => {
      const m = /^out_time_us=(\d+)/.exec(line);
      if (m) outTime = Number(m[1]) / 1e6;
    },
  });
  let failure: unknown;
  run.catch((e) => (failure = e)).finally(() => (ffmpegDone = true));
  while (!ffmpegDone) {
    await sleep(400, ctx.signal);
    throwIfAborted(ctx.signal);
    await processWindows();
    const frac = info.span ? outTime / info.span : 0;
    onProgress(Math.min(0.99, frac), `${v.name}: ${kept} frames`);
  }
  if (failure) throw failure;
  await processWindows();
  await rm(tmp, { recursive: true, force: true });
  ctx.log(`${v.name}: kept ${kept} sharpest frames out of ${kept * window} candidates`);
  return kept;
}

export const mediaPlugin = definePlugin({
  id: 'splatcraft.media',
  name: 'Media',
  version: '0.1.0',
  description: 'FFmpeg tools and frame preparation from photos and videos.',
  register(api) {
    api.registerTool(ffmpegTool);
    api.registerTool(ffprobeTool);
    api.registerStage(framesStage);
  },
});
