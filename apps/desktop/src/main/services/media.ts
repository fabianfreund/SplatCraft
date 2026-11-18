import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { classifySource } from '@splatcraft/core';
import type { Toolchain } from '@splatcraft/toolchain';
import type { PendingSource } from '@shared/api';

/** Duration of a video in seconds via ffprobe, or undefined (no ffprobe, unreadable, timeout). */
export function probeDuration(ffprobe: string, file: string, timeoutMs = 5000): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { timeout: timeoutMs }, (err, stdout) => {
      const d = Number(String(stdout).trim());
      resolve(!err && Number.isFinite(d) && d > 0 ? d : undefined);
    });
  });
}

/** Describes files for the import dialog. Folders and missing files are skipped. */
export async function describeFiles(files: string[], toolchain: Pick<Toolchain, 'resolve'>): Promise<PendingSource[]> {
  const out: PendingSource[] = [];
  for (const file of new Set(files.map((f) => path.resolve(f)))) {
    const st = await stat(file).catch(() => undefined);
    if (!st?.isFile()) continue;
    out.push({ path: file, name: path.basename(file), kind: classifySource(file), size: st.size });
  }
  const videos = out.filter((f) => f.kind === 'video');
  if (videos.length) {
    // The renderer reads durations from <video>; ffprobe covers formats Chromium can't play.
    const ffprobe = await toolchain.resolve('ffprobe').then((t) => t.path, () => undefined);
    if (ffprobe) await Promise.all(videos.map(async (v) => (v.duration = await probeDuration(ffprobe, v.path))));
  }
  return out;
}
