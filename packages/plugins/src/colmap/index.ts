import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { definePlugin, defineStage, StageError, type StageContext, type ToolSpec } from '@splatcraft/core';
import sharp from 'sharp';
import { z } from 'zod';
import { ensureDir, execText, exists, freshDir, linkOrCopy, listImages, pool, readPlyInfo } from '../util/fs.js';
import { throttledProgress } from '../util/preview.js';
import { colmapLineProgress, parseImagesTxt, parseModelAnalyzer, type ModelStats } from './model.js';

const manualLinux = { type: 'manual' as const, instructions: 'Install COLMAP 4.x from your package manager or build it from source.', url: 'https://colmap.github.io/install.html' };

export const colmapTool: ToolSpec = {
  id: 'colmap',
  name: 'COLMAP',
  description: 'Structure-from-Motion: camera poses and sparse points.',
  license: 'BSD-3-Clause',
  homepage: 'https://colmap.github.io',
  executables: ['colmap', 'COLMAP'],
  versionArgs: ['version'],
  parseVersion: (out) => /COLMAP\s+([\d.]+\S*)/.exec(out)?.[1],
  install: {
    'darwin-arm64': { type: 'brew', formula: 'colmap' },
    'darwin-x64': { type: 'brew', formula: 'colmap' },
    'win32-x64': {
      type: 'download',
      // CPU build works everywhere; swap for colmap-x64-windows-cuda.zip on NVIDIA machines.
      url: 'https://github.com/colmap/colmap/releases/download/4.2.1/colmap-x64-windows-nocuda.zip',
      sha256: 'c493d88cb4a43f21afba42cb55bf786e5434a0420e73db0ba1454c5d8b3686ae',
      archive: 'zip',
      binPath: 'bin/colmap.exe',
    },
    'linux-x64': manualLinux,
    'linux-arm64': manualLinux,
  },
};

const CAMERA_MODELS = ['SIMPLE_PINHOLE', 'PINHOLE', 'SIMPLE_RADIAL', 'RADIAL', 'OPENCV'] as const;

export const colmapParams = z.object({
  cameraModel: z.enum(CAMERA_MODELS).default('OPENCV').describe('Camera model to estimate. OPENCV models lens distortion; images are undistorted afterwards when "undistort" is on.'),
  singleCamera: z.boolean().default(true).describe('All frames come from the same camera/lens (shares intrinsics; more robust).'),
  maxImageSize: z.number().int().min(320).max(8192).default(1600).describe('Longest side used for feature extraction.'),
  maxFeatures: z.number().int().min(512).max(65536).default(8192).describe('Maximum SIFT features per image.'),
  matcher: z.enum(['auto', 'exhaustive', 'sequential']).default('auto').describe('Feature matching strategy. auto = exhaustive below 150 frames, sequential (video order, with loop detection off) otherwise.'),
  sequentialOverlap: z.number().int().min(2).max(100).default(15).describe('Sequential matcher: how many neighbouring frames to match against.'),
  mapper: z.enum(['global', 'incremental']).default('global').describe('Reconstruction method. global (GLOMAP-style) is much faster; incremental can be more robust for hard captures.'),
  undistort: z.boolean().default(true).describe('Undistort images to a pinhole model for training (recommended unless the camera model has no distortion).'),
  useGpu: z.enum(['auto', 'on', 'off']).default('auto').describe('Use the GPU for SIFT/matching/BA when this COLMAP build supports CUDA.'),
  numThreads: z.number().int().min(-1).max(256).default(-1).describe('CPU threads (−1 = all cores).'),
});
export type ColmapParams = z.infer<typeof colmapParams>;

let gpuSupport: Promise<boolean> | undefined;
function colmapHasGpu(exe: string) {
  gpuSupport ??= execText(exe, ['-h'], 10000)
    .catch((e) => (e as any).output ?? '')
    .then((out: string) => /with CUDA|with GPU/i.test(out) && !/without (CUDA|GPU)/i.test(out));
  return gpuSupport;
}

export const colmapStage = defineStage<ColmapParams>({
  id: 'splatcraft.align.colmap',
  version: '2',
  title: 'Align (COLMAP)',
  description: 'Finds camera poses and a sparse point cloud with COLMAP (feature extraction, matching, global or incremental mapping).',
  category: 'align',
  paramsSchema: colmapParams as z.ZodType<ColmapParams>,
  presets: {
    fast: { maxImageSize: 1000, maxFeatures: 4096, mapper: 'global' },
    balanced: { maxImageSize: 1600, maxFeatures: 8192, mapper: 'global' },
    quality: { maxImageSize: 2400, maxFeatures: 16384, mapper: 'global' },
  },
  tools: ['colmap'],
  inputs: ['frames'],
  outputs: ['dataset'],
  async run(ctx) {
    const frames = ctx.inputs.frames?.path;
    if (!frames) throw new Error('No frames input');
    const files = await listImages(frames);
    if (files.length < 3) {
      throw new StageError(`Only ${files.length} usable frame${files.length === 1 ? '' : 's'}: alignment needs at least 3`, {
        code: 'colmap.too-few-frames',
        hint: 'Add more photos or a longer video, or re-include frames that the review step rejected.',
      });
    }
    const p = ctx.params;
    const gpu = p.useGpu === 'on' || (p.useGpu === 'auto' && (await colmapHasGpu(ctx.tools.colmap)));
    const g = gpu ? '1' : '0';
    const progress = throttledProgress(ctx);
    const common = ['--log_target', 'stderr', '--log_color', '0'];

    // Work layout: input images + database outside the dataset folder.
    const imagesIn = await freshDir(path.join(ctx.workDir, 'images'));
    await pool(files, 8, (f) => linkOrCopy(f, path.join(imagesIn, path.basename(f))), ctx.signal);
    const db = path.join(ctx.workDir, 'database.db');
    await rm(db, { force: true });

    const phase = async (name: 'extract' | 'match' | 'map', from: number, to: number, label: string, args: string[]) => {
      progress(from, label, true);
      await ctx.spawn('colmap', [...args, ...common], {
        onLine: (line) => {
          const f = colmapLineProgress(line, name, files.length);
          if (f !== undefined) progress(from + (to - from) * f, label);
        },
      });
    };

    // 1. Features. "Single camera" only makes sense per physical camera: frames with
    // different sizes (e.g. a phone photo + video frames) each get their own camera,
    // otherwise COLMAP silently skips every image that doesn't match the first one.
    const groups = p.singleCamera ? await groupBySize(files) : [{ size: 'mixed', files }];
    if (groups.length > 1) {
      ctx.notice({
        level: 'info',
        code: 'colmap.multiple-cameras',
        title: `${groups.length} cameras detected`,
        detail: groups.map((g) => `${g.size} (${g.files.length} images)`).join(' · '),
        hint: 'Images with different sizes are calibrated separately.',
      });
    }
    let skipped = 0;
    for (const [i, group] of groups.entries()) {
      const listArgs: string[] = [];
      if (groups.length > 1) {
        const list = path.join(ctx.workDir, `images_cam${i + 1}.txt`);
        await writeFile(list, group.files.map((f) => path.basename(f)).join('\n') + '\n');
        listArgs.push('--image_list_path', list);
      }
      const from = (0.3 * i) / groups.length;
      const to = (0.3 * (i + 1)) / groups.length;
      progress(from, 'Extracting features', true);
      await ctx.spawn('colmap', [
        'feature_extractor',
        '--database_path', db,
        '--image_path', imagesIn,
        ...listArgs,
        '--ImageReader.camera_model', p.cameraModel,
        '--ImageReader.single_camera', p.singleCamera ? '1' : '0',
        '--FeatureExtraction.use_gpu', g,
        '--FeatureExtraction.num_threads', String(p.numThreads),
        '--FeatureExtraction.max_image_size', String(p.maxImageSize),
        '--SiftExtraction.max_num_features', String(p.maxFeatures),
        ...common,
      ], {
        onLine: (line) => {
          if (/_ERROR:|Skipping|skipped/i.test(line) && !/Processed file/.test(line)) skipped++;
          const f = colmapLineProgress(line, 'extract', group.files.length);
          if (f !== undefined) progress(from + (to - from) * f, 'Extracting features');
        },
      });
    }
    if (skipped > 0) {
      ctx.notice({
        level: 'warning',
        code: 'colmap.images-skipped',
        title: `${skipped} of ${files.length} images were skipped during feature extraction`,
        hint: 'Check the log for the reason (often unreadable or inconsistent images).',
      });
    }

    // 2. Matching
    const matcher = p.matcher === 'auto' ? (files.length < 150 ? 'exhaustive' : 'sequential') : p.matcher;
    const matchArgs =
      matcher === 'exhaustive'
        ? ['exhaustive_matcher']
        : ['sequential_matcher', '--SequentialMatching.overlap', String(p.sequentialOverlap), '--SequentialMatching.quadratic_overlap', '1'];
    await phase('match', 0.3, 0.55, `Matching (${matcher})`, [
      ...matchArgs,
      '--database_path', db,
      '--FeatureMatching.use_gpu', g,
      '--FeatureMatching.num_threads', String(p.numThreads),
    ]);

    // 3. Mapping. If the chosen mapper finds nothing, try the other one before giving up
    // (global SfM needs good focal priors, which video frames without EXIF lack).
    const rawDir = await freshDir(path.join(ctx.workDir, 'sparse_raw'));
    const mapperArgs = (m: 'global' | 'incremental') =>
      m === 'global'
        ? ['global_mapper', '--GlobalMapper.gp_use_gpu', g, '--GlobalMapper.ba_ceres_use_gpu', g, '--GlobalMapper.num_threads', String(p.numThreads)]
        : ['mapper', '--Mapper.ba_use_gpu', g, '--Mapper.num_threads', String(p.numThreads)];
    const diag = { emptyGraph: false, noInitialPair: false, noFocalPriors: false };
    const runMapper = async (m: 'global' | 'incremental', from: number, to: number) => {
      await rm(rawDir, { recursive: true, force: true });
      await ensureDir(rawDir);
      progress(from, `Reconstructing (${m})`, true);
      await ctx
        .spawn('colmap', [...mapperArgs(m), '--database_path', db, '--image_path', imagesIn, '--output_path', rawDir, ...common], {
          onLine: (line) => {
            if (/empty pose graph/i.test(line)) diag.emptyGraph = true;
            if (/No good initial image pair/i.test(line)) diag.noInitialPair = true;
            if (/prior focal lengths/i.test(line)) diag.noFocalPriors = true;
            const f = colmapLineProgress(line, 'map', files.length);
            if (f !== undefined) progress(from + (to - from) * f, `Reconstructing (${m})`);
          },
        })
        .catch((e) => {
          if (ctx.signal.aborted) throw e;
          ctx.log(`${m} mapper failed: ${(e as Error).message}`, 'warn');
        });
      return pickBest(ctx, rawDir);
    };
    let usedMapper = p.mapper;
    let { best, models } = await runMapper(p.mapper, 0.55, 0.85);
    if ((best?.stats.registeredImages ?? 0) < 3) {
      const other = p.mapper === 'global' ? 'incremental' : 'global';
      ctx.notice({
        level: 'info',
        code: 'colmap.mapper-fallback',
        title: `${p.mapper === 'global' ? 'Global' : 'Incremental'} mapper found no model; retrying with ${other}`,
      });
      usedMapper = other;
      ({ best, models } = await runMapper(other, 0.6, 0.85));
    }
    if (!best || (best.stats.registeredImages ?? 0) < 3) {
      throw new StageError('Cameras could not be aligned', {
        code: 'colmap.no-model',
        detail: diag.emptyGraph || diag.noInitialPair
          ? 'COLMAP found no image pairs with enough shared features.'
          : `No reconstruction with at least 3 cameras (from ${files.length} images).`,
        hint: 'Use photos/video of ONE scene with ~60–80% overlap between neighbours, avoid motion blur and plain surfaces. Mixing unrelated photos breaks alignment.',
      });
    }
    if (models.length > 1) ctx.log(`COLMAP produced ${models.length} models; using the largest (${best.stats.registeredImages} images).`, 'warn');
    const reg = best.stats.registeredImages ?? 0;
    if (reg < files.length * 0.6) {
      ctx.notice({
        level: 'warning',
        code: 'colmap.partial',
        title: `Only ${reg} of ${files.length} cameras aligned`,
        detail: models.length > 1 ? `The scene split into ${models.length} disconnected parts; the largest is used.` : undefined,
        hint: 'Unaligned images are ignored for training. More overlap between shots usually fixes this.',
      });
    }

    // 5. Dataset (COLMAP layout: images/ + sparse/0), optionally undistorted.
    const dataset = await freshDir(path.join(ctx.workDir, 'dataset'));
    const hasDistortion = p.cameraModel === 'OPENCV' || p.cameraModel === 'RADIAL' || p.cameraModel === 'SIMPLE_RADIAL';
    if (p.undistort && hasDistortion) {
      progress(0.86, 'Undistorting images', true);
      const und = path.join(ctx.workDir, 'undistorted');
      await rm(und, { recursive: true, force: true });
      await ctx.spawn('colmap', ['image_undistorter', '--image_path', imagesIn, '--input_path', best.dir, '--output_path', und, '--output_type', 'COLMAP', ...common]);
      await rename(path.join(und, 'images'), path.join(dataset, 'images'));
      await ensureDir(path.join(dataset, 'sparse'));
      await rename(path.join(und, 'sparse'), path.join(dataset, 'sparse', '0'));
      await rm(und, { recursive: true, force: true });
    } else {
      await ensureDir(path.join(dataset, 'sparse'));
      await rename(best.dir, path.join(dataset, 'sparse', '0'));
      const imgOut = await ensureDir(path.join(dataset, 'images'));
      await pool(files, 8, (f) => linkOrCopy(path.join(imagesIn, path.basename(f)), path.join(imgOut, path.basename(f))), ctx.signal);
    }
    const sparse0 = path.join(dataset, 'sparse', '0');

    // 6. Previews: point cloud + cameras. Kept OUTSIDE dataset/ (trainers treat any .ply there as init).
    progress(0.95, 'Exporting previews', true);
    const prevDir = await freshDir(path.join(ctx.workDir, 'preview'));
    const ply = path.join(prevDir, 'points.ply');
    let cameras = 0;
    try {
      await ctx.spawn('colmap', ['model_converter', '--input_path', sparse0, '--output_path', ply, '--output_type', 'PLY', ...common]);
      const info = await readPlyInfo(ply);
      ctx.preview({ kind: 'pointcloud', path: ply, points: info?.vertices });
      const txt = await ensureDir(path.join(prevDir, 'txt'));
      await ctx.spawn('colmap', ['model_converter', '--input_path', sparse0, '--output_path', txt, '--output_type', 'TXT', ...common]);
      const poses = parseImagesTxt(await readFile(path.join(txt, 'images.txt'), 'utf8'));
      cameras = poses.length;
      ctx.preview({ kind: 'cameras', cameras: poses });
      await rm(path.join(txt, 'points3D.txt'), { force: true }); // large; not needed after parsing
    } catch (e) {
      ctx.log(`Preview export failed: ${(e as Error).message}`, 'warn');
    }

    const final = await analyze(ctx, sparse0).catch(() => best!.stats);
    const s = { ...best.stats, ...final };
    await rm(imagesIn, { recursive: true, force: true }).catch(() => {});
    await rm(rawDir, { recursive: true, force: true }).catch(() => {});
    progress(1, `${s.registeredImages}/${files.length} cameras registered`, true);
    return {
      outputs: {
        dataset: {
          path: dataset,
          meta: { images: s.registeredImages, points: s.points, pointsPly: (await exists(ply)) ? ply : undefined, cameraModel: p.undistort && hasDistortion ? 'PINHOLE' : p.cameraModel },
        },
      },
      stats: {
        registered: `${s.registeredImages ?? cameras}/${files.length}`,
        registeredImages: s.registeredImages ?? cameras,
        totalImages: files.length,
        points: s.points ?? 0,
        ...(s.meanReprojectionError !== undefined ? { reprojErrorPx: Number(s.meanReprojectionError.toFixed(3)) } : {}),
        ...(s.meanTrackLength !== undefined ? { meanTrackLength: Number(s.meanTrackLength.toFixed(2)) } : {}),
        matcher,
        mapper: usedMapper,
        cameras: groups.length,
        models: models.length,
      },
    };
  },
});

async function pickBest(ctx: StageContext<ColmapParams>, rawDir: string) {
  const models = (await readdir(rawDir, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory())
    .map((d) => path.join(rawDir, d.name));
  let best: { dir: string; stats: ModelStats } | undefined;
  for (const dir of models) {
    const stats = await analyze(ctx, dir).catch(() => ({}) as ModelStats);
    if (!best || (stats.registeredImages ?? 0) > (best.stats.registeredImages ?? 0)) best = { dir, stats };
  }
  return { best, models };
}

/** Group image files by pixel dimensions (≈ physical camera / lens / orientation). */
async function groupBySize(files: string[]) {
  const map = new Map<string, string[]>();
  for (const f of files) {
    const m = await sharp(f).metadata().catch(() => undefined);
    const key = m?.width && m?.height ? `${m.width}×${m.height}` : 'unknown';
    map.set(key, [...(map.get(key) ?? []), f]);
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length).map(([size, files]) => ({ size, files }));
}

async function analyze(ctx: StageContext<ColmapParams>, dir: string): Promise<ModelStats> {
  let out = '';
  await ctx.spawn('colmap', ['model_analyzer', '--path', dir, '--log_target', 'stderr', '--log_color', '0'], { onLine: (l) => (out += l + '\n') });
  return parseModelAnalyzer(out);
}

export const colmapPlugin = definePlugin({
  id: 'splatcraft.colmap',
  name: 'COLMAP',
  version: '0.1.0',
  description: 'Structure-from-Motion alignment with COLMAP 4.x.',
  register(api) {
    api.registerTool(colmapTool);
    api.registerStage(colmapStage);
  },
});
