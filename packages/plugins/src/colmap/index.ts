import { readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { definePlugin, defineStage, StageError, type StageContext, type ToolSpec } from '@splatcraft/core';
import { z } from 'zod';
import { ensureDir, execText, exists, freshDir, linkOrCopy, listImages, pool } from '../util/fs.js';
import { throttledProgress } from '../util/preview.js';
import { emitModelPreview, snapshotFrequency, watchSnapshots } from './live.js';
import { colmapLineProgress, parseModelAnalyzer, type ModelStats } from './model.js';
import { cameraCounts, detectCameras, groupCameras, type CameraGroup } from './cameras.js';
import { injectTiePoints, normalizeTracks, tieTrackSchema, trackPairs } from './tiepoints.js';

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
  singleCamera: z.boolean().default(true).describe('Share one camera (lens) per detected camera: same EXIF body + lens + focal length, or one video. Photos without lens data always get their own. Off = one camera per image.'),
  maxImageSize: z.number().int().min(320).max(8192).default(1600).describe('Longest side used for feature extraction.'),
  maxFeatures: z.number().int().min(512).max(65536).default(8192).describe('Maximum SIFT features per image.'),
  tiePoints: z
    .array(tieTrackSchema)
    .optional() // no default: unset stays out of the cache key, so older results stay valid
    .describe('Feature points the user clicked: each track is the same spot in several frames. Added as extra matches; frames sharing a track are matched and re-verified with them.'),
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
        hint: 'Add more photos or a longer video, or re-include frames that the Prepare step rejected.',
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

    // 0. Cameras: which frames share a lens (EXIF body + lens + focal, or one video), and
    // which have a focal prior. Photos without lens data each get their own camera.
    progress(0, 'Detecting cameras', true);
    const frameCams = await detectCameras(files);
    const groups: CameraGroup[] = p.singleCamera ? groupCameras(frameCams) : [{ shared: false, label: 'Per image', files, focal: frameCams.some((c) => c.focal) }];
    const counts = cameraCounts(groups);
    // An unordered photo collection (no video, small enough for exhaustive matching) gets the
    // thorough settings: wide-baseline features, guided matching, forgiving incremental mapping.
    const collection = !frameCams.some((c) => c.kind === 'video') && files.length <= COLLECTION_MAX;
    ctx.notice({
      level: 'info',
      code: 'colmap.cameras',
      title: `${counts.cameras} camera${counts.cameras === 1 ? '' : 's'} detected · ${counts.withFocal ? `${counts.withFocal} with lens data` : 'no lens data'}`,
      detail: groups.map((g) => `${g.label}: ${g.files.length} ${g.files.length === 1 ? 'image' : 'images'}${g.shared ? '' : ' (one camera each)'}`).join(' · '),
      ...(counts.withFocal < counts.cameras
        ? { hint: 'Focal lengths without lens data (EXIF) are estimated during alignment. Original camera files align better than downloaded or edited copies.' }
        : {}),
    });
    const robustExtract = collection ? await supportedOptions(ctx.tools.colmap, 'feature_extractor', ROBUST_FEATURES) : [];
    let skipped = 0;
    for (const [i, group] of groups.entries()) {
      const listArgs: string[] = [];
      if (groups.length > 1 || !group.shared) {
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
        '--ImageReader.single_camera', group.shared ? '1' : '0',
        '--FeatureExtraction.use_gpu', g,
        '--FeatureExtraction.num_threads', String(p.numThreads),
        '--FeatureExtraction.max_image_size', String(p.maxImageSize),
        '--SiftExtraction.max_num_features', String(p.maxFeatures),
        ...robustExtract,
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

    // Feature points the user placed (tracks of the same spot in several frames).
    const tracks = normalizeTracks(p.tiePoints ?? [], files.map((f) => path.basename(f)));
    const pairs = trackPairs(tracks);

    // 2b. Matching
    const matcher = p.matcher === 'auto' ? (files.length < 150 ? 'exhaustive' : 'sequential') : p.matcher;
    const matchArgs =
      matcher === 'exhaustive'
        ? ['exhaustive_matcher']
        : ['sequential_matcher', '--SequentialMatching.overlap', String(p.sequentialOverlap), '--SequentialMatching.quadratic_overlap', '1'];
    const guided = collection ? await supportedOptions(ctx.tools.colmap, matchArgs[0]!, { 'FeatureMatching.guided_matching': '1' }) : [];
    await phase('match', 0.3, 0.55, `Matching (${matcher})`, [
      ...matchArgs,
      ...guided,
      '--database_path', db,
      '--FeatureMatching.use_gpu', g,
      '--FeatureMatching.num_threads', String(p.numThreads),
    ]);

    // 2b'. Sequential matching only tries neighbours: match frames that share a feature point too
    // (normal settings; exhaustive matching has tried every pair already).
    if (pairs.length && matcher !== 'exhaustive') {
      const list = path.join(ctx.workDir, 'tie_pairs.txt');
      await writeFile(list, pairs.map(([a, b]) => `${a} ${b}`).join('\n') + '\n');
      progress(0.5, `Matching ${pairs.length} frame pair${pairs.length === 1 ? '' : 's'} with feature points`, true);
      await ctx.spawn('colmap', [
        'matches_importer',
        '--database_path', db,
        '--match_list_path', list,
        '--match_type', 'pairs',
        '--FeatureMatching.use_gpu', g,
        '--FeatureMatching.num_threads', String(p.numThreads),
        ...guided,
        ...common,
      ]);
    }

    // 2c. Feature points: append them as keypoints and re-verify the tracked pairs with them.
    if (tracks.length) {
      const reverify = await supportedOptions(ctx.tools.colmap, 'matches_importer', REVERIFY);
      progress(0.55, 'Adding feature points', true);
      const { DatabaseSync } = await import('node:sqlite').catch(() => {
        throw new StageError('Feature points need a newer Node.js', { code: 'colmap.no-sqlite', hint: 'Use Node.js 22.13 or newer for the CLI, or the desktop app.' });
      });
      const sql = new DatabaseSync(db);
      let injected: ReturnType<typeof injectTiePoints>;
      try {
        injected = injectTiePoints(sql, tracks);
      } finally {
        sql.close();
      }
      if (injected.rawMatches) {
        const raw = path.join(ctx.workDir, 'tie_matches.txt');
        await writeFile(raw, injected.rawMatches);
        await ctx.spawn('colmap', [
          'matches_importer',
          '--database_path', db,
          '--match_list_path', raw,
          '--match_type', 'raw',
          '--FeatureMatching.use_gpu', g,
          '--FeatureMatching.num_threads', String(p.numThreads),
          ...reverify,
          ...common,
        ]);
        ctx.log(`Added ${injected.points} feature points in ${tracks.length} track${tracks.length === 1 ? '' : 's'} (${injected.pairs} frame pairs re-verified).`);
      }
    }

    // 3. Mapping. If the chosen mapper finds nothing, try the other one before giving up
    // (global SfM needs good focal priors, which video frames without EXIF lack).
    const rawDir = await freshDir(path.join(ctx.workDir, 'sparse_raw'));
    const relaxed = collection ? await supportedOptions(ctx.tools.colmap, 'mapper', RELAXED_MAPPER) : [];
    const mapperArgs = (m: 'global' | 'incremental') =>
      m === 'global'
        ? ['global_mapper', '--GlobalMapper.gp_use_gpu', g, '--GlobalMapper.ba_ceres_use_gpu', g, '--GlobalMapper.num_threads', String(p.numThreads)]
        : ['mapper', '--Mapper.ba_use_gpu', g, '--Mapper.num_threads', String(p.numThreads), ...relaxed];
    const diag = { emptyGraph: false, noInitialPair: false, noFocalPriors: false };
    // Incremental mapping writes partial models as it grows: preview them live.
    // (The global mapper solves everything at once; it previews when it finishes.)
    const snapDir = path.join(ctx.workDir, 'snapshots');
    const liveDir = path.join(ctx.workDir, 'live');
    const runMapper = async (m: 'global' | 'incremental', from: number, to: number) => {
      await rm(rawDir, { recursive: true, force: true });
      await ensureDir(rawDir);
      progress(from, `Reconstructing (${m})`, true);
      const live = m === 'incremental' ? watchSnapshots(ctx, await freshDir(snapDir), await freshDir(liveDir)) : undefined;
      const snapArgs = live ? ['--Mapper.snapshot_path', snapDir, '--Mapper.snapshot_frames_freq', String(snapshotFrequency(files.length))] : [];
      await ctx
        .spawn('colmap', [...mapperArgs(m), ...snapArgs, '--database_path', db, '--image_path', imagesIn, '--output_path', rawDir, ...common], {
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
        })
        .finally(() => live?.stop());
      return pickBest(ctx, rawDir);
    };
    // Global SfM needs focal priors for most cameras; without them it fails, so start incremental.
    let first: 'global' | 'incremental' = p.mapper;
    if (first === 'global' && counts.withFocal < counts.cameras / 2) {
      first = 'incremental';
      ctx.log(`Only ${counts.withFocal} of ${counts.cameras} cameras have a focal prior: using the incremental mapper.`);
    }
    let usedMapper = first;
    let { best, models } = await runMapper(first, 0.55, 0.85);
    if ((best?.stats.registeredImages ?? 0) < 3) {
      const other = first === 'global' ? 'incremental' : 'global';
      ctx.notice({
        level: 'info',
        code: 'colmap.mapper-fallback',
        title: `${first === 'global' ? 'Global' : 'Incremental'} mapper found no model; retrying with ${other}`,
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
        hint: 'Unaligned images are ignored for training. Mark the same spots in an unaligned frame and in aligned ones (Prepare step → Feature points), or shoot with more overlap.',
      });
    }

    // 4. Previews: point cloud + cameras of the chosen model, right away (undistortion
    // keeps poses and points). Kept OUTSIDE dataset/ (trainers treat any .ply there as init).
    progress(0.86, 'Exporting previews', true);
    const prevDir = await freshDir(path.join(ctx.workDir, 'preview'));
    let ply = path.join(prevDir, 'points.ply');
    let cameras = 0;
    try {
      ({ ply, cameras } = await emitModelPreview(ctx, best.dir, prevDir));
    } catch (e) {
      ctx.log(`Preview export failed: ${(e as Error).message}`, 'warn');
    }
    await rm(snapDir, { recursive: true, force: true }).catch(() => {});
    await rm(liveDir, { recursive: true, force: true }).catch(() => {});

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
        cameras: counts.cameras,
        lensData: counts.withFocal,
        models: models.length,
      },
    };
  },
});

/** Photo collections up to this size get the thorough settings (they're matched exhaustively anyway). */
const COLLECTION_MAX = 150;

/** Wide-baseline features for unordered photos (CPU SIFT; slower, but far more matches across viewpoints). */
const ROBUST_FEATURES: Record<string, string> = {
  'SiftExtraction.estimate_affine_shape': '1',
  'SiftExtraction.domain_size_pooling': '1',
};

/** Forgiving incremental mapping for photo collections: register images with fewer, weaker matches. */
const RELAXED_MAPPER: Record<string, string> = {
  'Mapper.abs_pose_min_num_inliers': '15',
  'Mapper.abs_pose_min_inlier_ratio': '0.15',
  'Mapper.init_min_num_inliers': '50',
  'Mapper.min_num_matches': '10',
  'Mapper.init_min_tri_angle': '4',
};

/**
 * Re-verifying pairs that contain clicked points: accept a pair with fewer inliers (the clicked
 * matches are trusted). Matching itself keeps COLMAP's defaults: looser ratio tests flood whole
 * photo sets with outliers once a track spans many frames.
 */
const REVERIFY: Record<string, string> = { 'TwoViewGeometry.min_num_inliers': '8' };

const helpCache = new Map<string, Promise<string>>();
async function supportedOptions(exe: string, command: string, opts: Record<string, string>): Promise<string[]> {
  const key = `${exe}\n${command}`;
  if (!helpCache.has(key)) helpCache.set(key, execText(exe, [command, '-h'], 10000).catch((e) => String((e as any)?.output ?? (e as any)?.stdout ?? '')));
  const help = await helpCache.get(key)!;
  return Object.entries(opts).flatMap(([k, v]) => (help.includes(`--${k} `) ? [`--${k}`, v] : []));
}

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
