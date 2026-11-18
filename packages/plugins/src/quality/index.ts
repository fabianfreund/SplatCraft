import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { definePlugin, defineStage } from '@splatcraft/core';
import { z } from 'zod';
import { freshDir, linkOrCopy, listImages, pool } from '../util/fs.js';
import { analyzeImage, median, type ImageMetrics } from '../util/image.js';
import { throttledProgress } from '../util/preview.js';
import { decideFrames } from './decide.js';

export const qualityParams = z.object({
  blurThreshold: z.number().min(0).max(100).default(35).describe('Reject frames whose sharpness is below this percentage of the median sharpness (relative, so it works for any camera). 0 = off.'),
  minBrightness: z.number().min(0).max(255).default(25).describe('Reject frames darker than this mean luminance (0–255).'),
  maxBrightness: z.number().min(0).max(255).default(235).describe('Reject frames brighter than this mean luminance (0–255).'),
  maxClipped: z.number().min(0).max(1).default(0.35).describe('Reject frames with more than this fraction of pure black or pure white pixels.'),
  duplicateThreshold: z.number().int().min(-1).max(64).default(2).describe('Reject a frame as near-duplicate when its difference hash is within this many bits (of 64) of the previous kept frame. −1 = off.'),
  maxFrames: z.number().int().min(0).default(300).describe('Keep at most this many frames, choosing the sharpest evenly over the sequence (0 = unlimited).'),
  analysisSize: z.number().int().min(128).max(2048).default(512).describe('Longest side used for scoring (smaller = faster).'),
  excluded: z.array(z.string()).default([]).describe('Frame file names to always drop (user override).'),
  included: z.array(z.string()).default([]).describe('Frame file names to always keep (user override, wins over every filter).'),
});
export type QualityParams = z.infer<typeof qualityParams>;

export const qualityStage = defineStage<QualityParams>({
  id: 'splatcraft.filter.quality',
  version: '1',
  title: 'Quality filter',
  description: 'Scores sharpness, exposure and near-duplicates and drops weak frames. Overrides per frame are respected.',
  category: 'filter',
  paramsSchema: qualityParams as z.ZodType<QualityParams>,
  presets: {
    fast: { maxFrames: 150, analysisSize: 384 },
    balanced: { maxFrames: 300 },
    quality: { maxFrames: 600, blurThreshold: 30 },
  },
  inputs: ['frames'],
  outputs: ['frames'],
  async run(ctx) {
    const src = ctx.inputs.frames?.path;
    if (!src) throw new Error('No frames input');
    const files = await listImages(src);
    if (!files.length) throw new Error('The frames folder is empty');
    const progress = throttledProgress(ctx);

    let done = 0;
    const metrics = await pool(files, Math.max(2, Math.min(8, os.cpus().length - 1)), async (f) => {
      const m: ImageMetrics = await analyzeImage(f, ctx.params.analysisSize).catch((e) => {
        ctx.log(`Could not read ${path.basename(f)}: ${e.message}`, 'warn');
        return { sharpness: 0, brightness: 0, darkClip: 1, brightClip: 0, dhash: '0000000000000000' };
      });
      done++;
      progress((done / files.length) * 0.9, `Scoring ${done}/${files.length}`);
      return m;
    }, ctx.signal);

    const decisions = decideFrames(files.map((f, i) => ({ name: path.basename(f), metrics: metrics[i] })), ctx.params);

    const outDir = await freshDir(path.join(ctx.workDir, 'frames'));
    const kept = decisions.filter((d) => d.kept);
    if (!kept.length) throw new Error('Every frame was rejected — lower the blur threshold or exposure limits.');
    await pool(kept, 8, (d) => linkOrCopy(path.join(src, d.name), path.join(outDir, d.name)), ctx.signal);

    await writeFile(
      path.join(ctx.workDir, 'scores.json'),
      JSON.stringify({ medianSharpness: median(metrics.map((m) => m.sharpness)), frames: decisions }, null, 2),
    );
    ctx.preview({
      kind: 'frameScores',
      items: decisions.map((d) => ({ path: path.join(src, d.name), score: Number(d.score.toFixed(3)), kept: d.kept, reason: d.reason })),
    });
    ctx.preview({ kind: 'images', paths: kept.map((d) => path.join(outDir, d.name)), append: false });

    const rejected: Record<string, number> = {};
    for (const d of decisions) if (!d.kept && d.reason) rejected[d.reason] = (rejected[d.reason] ?? 0) + 1;
    progress(1, `Kept ${kept.length}/${files.length}`, true);
    return {
      outputs: { frames: { path: outDir, meta: { count: kept.length, scores: path.join(ctx.workDir, 'scores.json') } } },
      stats: {
        frames: files.length,
        kept: kept.length,
        rejected: files.length - kept.length,
        ...Object.fromEntries(Object.entries(rejected).map(([k, v]) => [`rejected_${k}`, v])),
      },
    };
  },
});

export const qualityPlugin = definePlugin({
  id: 'splatcraft.quality',
  name: 'Quality filter',
  version: '0.1.0',
  description: 'Sharpness, exposure and duplicate scoring for frames.',
  register(api) {
    api.registerStage(qualityStage);
  },
});
