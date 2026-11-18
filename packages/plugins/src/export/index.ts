import { copyFile, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { definePlugin, defineStage, PROJECT_FILE } from '@splatcraft/core';
import { z } from 'zod';
import { ensureDir, linkOrCopy } from '../util/fs.js';

export const exportParams = z.object({
  name: z.string().default('').describe('File name (without extension) inside the project\'s exports/ folder. Empty = project name.'),
  format: z.enum(['ply']).default('ply').describe('Output format. PLY is the standard 3DGS format readable by every viewer.'),
  // TODO: 'spz' (Niantic, ~10× smaller) once an SPZ encoder ships with the toolchain.
});
export type ExportParams = z.infer<typeof exportParams>;

export const exportStage = defineStage<ExportParams>({
  id: 'splatcraft.export.files',
  version: '1',
  title: 'Export',
  description: 'Copies the trained splat into the project\'s exports/ folder.',
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
    await linkOrCopy(splat, local);
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
      stats: { file: path.relative(ctx.projectDir, dest), sizeMB: Number((size / 1e6).toFixed(1)) },
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
