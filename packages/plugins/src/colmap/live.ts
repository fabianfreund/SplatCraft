import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { StageContext } from '@splatcraft/core';
import { ensureDir, readPlyInfo, sleep } from '../util/fs.js';
import { parseImagesTxt } from './model.js';

const COMMON = ['--log_target', 'stderr', '--log_color', '0'];

/**
 * Converts a COLMAP model to preview files (points.ply + cameras) inside
 * `outDir` and emits them as `pointcloud` and `cameras` previews.
 */
export async function emitModelPreview(ctx: StageContext<unknown>, modelDir: string, outDir: string): Promise<{ ply: string; cameras: number; points?: number }> {
  await ensureDir(outDir);
  const ply = path.join(outDir, 'points.ply');
  await ctx.spawn('colmap', ['model_converter', '--input_path', modelDir, '--output_path', ply, '--output_type', 'PLY', ...COMMON]);
  const info = await readPlyInfo(ply);
  ctx.preview({ kind: 'pointcloud', path: ply, points: info?.vertices });
  const txt = await ensureDir(path.join(outDir, 'txt'));
  await ctx.spawn('colmap', ['model_converter', '--input_path', modelDir, '--output_path', txt, '--output_type', 'TXT', ...COMMON]);
  const poses = parseImagesTxt(await readFile(path.join(txt, 'images.txt'), 'utf8'));
  ctx.preview({ kind: 'cameras', cameras: poses });
  await rm(txt, { recursive: true, force: true }); // points3D.txt is large; only images.txt was needed
  return { ply, cameras: poses.length, points: info?.vertices };
}

/** Snapshot every N registered frames: ~10 updates per reconstruction, not too chatty. */
export function snapshotFrequency(totalImages: number): number {
  return Math.max(5, Math.round(totalImages / 10));
}

const POLL_MS = 1000;

/**
 * Watches the incremental mapper's `--Mapper.snapshot_path` and previews each
 * new snapshot once it is fully written (a newer one exists, or its size is stable for one poll).
 * Previews are best effort: failures are logged, never thrown.
 */
export function watchSnapshots(ctx: StageContext<unknown>, snapshotDir: string, liveDir: string) {
  let stopped = false;
  let seq = 0;
  let shown: string | undefined;
  /** Newest snapshot and its size at the last poll. */
  let pending: { dir: string; size: number } | undefined;

  const dirSize = async (dir: string) => {
    let total = 0;
    for (const f of await readdir(dir)) total += (await stat(path.join(dir, f)).catch(() => ({ size: 0 }))).size;
    return total;
  };

  const tick = async () => {
    const dirs = (await readdir(snapshotDir, { withFileTypes: true }).catch(() => []))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort(); // COLMAP names snapshots by timestamp
    const newest = dirs.at(-1);
    if (!newest) return;
    // A snapshot is complete once a newer one exists, or when its size is stable for one poll.
    let pick: string | undefined;
    const size = await dirSize(path.join(snapshotDir, newest));
    if (size && pending?.dir === newest && pending.size === size) pick = newest;
    else {
      pending = { dir: newest, size };
      pick = dirs.at(-2);
    }
    if (!pick || (shown !== undefined && pick <= shown)) return;
    shown = pick;
    const dir = path.join(snapshotDir, pick);
    // A fresh folder per snapshot: the viewer may still be reading the previous one.
    const out = path.join(liveDir, String(++seq));
    try {
      const r = await emitModelPreview(ctx, dir, out);
      ctx.progress({ message: `Reconstructing · ${r.cameras} cameras` });
      if (seq > 2) await rm(path.join(liveDir, String(seq - 2)), { recursive: true, force: true });
    } catch (e) {
      ctx.log(`Live preview skipped: ${(e as Error).message}`, 'debug');
    }
  };

  const loop = (async () => {
    while (!stopped && !ctx.signal.aborted) {
      await tick().catch(() => {});
      await sleep(POLL_MS, ctx.signal).catch(() => {});
    }
  })();

  return {
    async stop() {
      stopped = true;
      await loop;
    },
  };
}
