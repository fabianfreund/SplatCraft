import { copyFile, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { alignmentTransform, definePlugin, defineStage, isIdentity, LENGTH_UNITS, metersPerUnit, PROJECT_FILE, StageError } from '@splatcraft/core';
import { z } from 'zod';
import { ensureDir, linkOrCopy } from '../util/fs.js';
import { transformPly } from './ply.js';

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

/** Mirrors `SceneAlignment` from @splatcraft/core (file coordinates). */
export const sceneAlignmentSchema = z.object({
  ground: z
    .object({
      points: z.tuple([vec3, vec3, vec3]),
      flip: z.boolean().optional(),
    })
    .optional(),
  scale: z
    .object({
      a: vec3,
      b: vec3,
      distance: z.number().positive(),
      unit: z.enum(LENGTH_UNITS),
    })
    .optional(),
});

export const exportParams = z.object({
  name: z.string().default('').describe('File name (without extension) inside the project\'s exports/ folder. Empty = project name.'),
  format: z.enum(['ply']).default('ply').describe('Output format. PLY is the standard 3DGS format readable by every viewer.'),
  alignment: sceneAlignmentSchema
    .optional()
    .describe('Ground plane (3 points) and scale reference (2 points + real distance) picked in the viewer. Baked into the exported file: the ground becomes level at the origin and 1 unit = 1 meter.'),
  // TODO: 'spz' (Niantic, ~10× smaller) once an SPZ encoder ships with the toolchain.
});
export type ExportParams = z.infer<typeof exportParams>;

export const exportStage = defineStage<ExportParams>({
  id: 'splatcraft.export.files',
  // Unchanged output without an alignment, which enters the cache key on their own.
  version: '1',
  title: 'Edit & Export',
  description: 'Levels the splat on a picked ground plane, scales it to real-world units and writes it into the project\'s exports/ folder.',
  category: 'export',
  paramsSchema: exportParams as z.ZodType<ExportParams>,
  presets: {},
  inputs: ['splat'],
  outputs: ['export'],
  async run(ctx) {
    const splat = ctx.inputs.splat?.path;
    if (!splat) throw new Error('No splat input');
    let name = ctx.params.name.trim();
    if (!name) {
      try {
        name = JSON.parse(await readFile(path.join(ctx.projectDir, PROJECT_FILE), 'utf8')).name ?? '';
      } catch {
        /* ignore */
      }
    }
    name = (name || 'splat').replace(/[\\/:*?"<>|]/g, '_').trim();

    // Keep a copy in the stage dir (cache-owned) and publish to exports/.
    const local = path.join(ctx.workDir, `${name}.ply`);
    const transform = alignmentTransform(ctx.params.alignment);
    const stats: Record<string, number | string> = {};
    if (isIdentity(transform)) {
      await linkOrCopy(splat, local);
    } else {
      const part = local + '.part';
      try {
        await transformPly(splat, part, transform, {
          signal: ctx.signal,
          onProgress: (f) => ctx.progress({ fraction: f * 0.9, message: 'Applying alignment' }),
        });
      } catch (e) {
        await rm(part, { force: true });
        if (ctx.signal.aborted) throw e;
        throw new StageError(`Could not transform the splat: ${(e as Error).message}`, {
          hint: 'Clear the ground plane and scale reference to export the file unchanged.',
          code: 'export.transform-failed',
        });
      }
      await rename(part, local);
      const mpu = metersPerUnit(ctx.params.alignment?.scale);
      if (mpu !== undefined) stats.scale = Number(mpu.toPrecision(4));
      if (ctx.params.alignment?.ground) stats.leveled = 'yes';
    }
    const exportsDir = await ensureDir(path.join(ctx.projectDir, 'exports'));
    const dest = path.join(exportsDir, `${name}.ply`);
    const tmp = dest + '.part';
    await copyFile(local, tmp);
    await rename(tmp, dest); // atomic: viewers never see half a file
    const size = (await stat(dest)).size;
    ctx.log(`Exported ${dest}`);
    ctx.progress({ fraction: 1, message: `Exported ${path.basename(dest)}` });
    return {
      outputs: { export: { path: local, meta: { files: [dest], format: 'ply' } } },
      stats: { file: path.relative(ctx.projectDir, dest), sizeMB: Number((size / 1e6).toFixed(1)), ...stats },
    };
  },
});

export const exportPlugin = definePlugin({
  id: 'splatcraft.export',
  name: 'Export',
  version: '0.1.0',
  description: 'Writes final files into the project exports/ folder.',
  register(api) {
    api.registerStage(exportStage);
  },
});
