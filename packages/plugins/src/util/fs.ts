import { execFile } from 'node:child_process';
import { copyFile, link, mkdir, open, readdir, rm, stat, symlink } from 'node:fs/promises';
import path from 'node:path';

export const IMAGE_FILE = /\.(jpe?g|png|tiff?|webp)$/i;

export async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Recreate an empty directory. */
export async function freshDir(dir: string) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Hardlink (instant, no extra disk) with copy fallback (cross-device, FAT …). */
export async function linkOrCopy(src: string, dest: string) {
  await rm(dest, { force: true });
  try {
    await link(src, dest);
  } catch {
    await copyFile(src, dest);
  }
}

/** Directory symlink (junction on Windows, which needs no admin rights). */
export async function linkDir(target: string, dest: string) {
  await rm(dest, { recursive: true, force: true });
  await symlink(target, dest, process.platform === 'win32' ? 'junction' : 'dir');
}

/** Image files in a directory, sorted by name (stable frame order). */
export async function listImages(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names
    .filter((n) => IMAGE_FILE.test(n) && !n.startsWith('.'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((n) => path.join(dir, n));
}

/** Run a command and capture output; rejects on timeout / non-zero exit. */
export function execText(exe: string, args: string[], timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        (err as any).output = `${stdout}\n${stderr}`;
        return reject(err);
      }
      resolve(`${stdout}\n${stderr}`);
    });
  });
}

export function abortError() {
  return new Error('cancelled');
}

export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw abortError();
}

export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

/** Run async fn over items with bounded concurrency, in order of completion. */
export async function pool<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      if (signal?.aborted) throw abortError();
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface PlyInfo {
  vertices: number;
  headerBytes: number;
  /** Bytes per vertex for binary files (0 if unknown/ascii). */
  stride: number;
  format: string;
  /** True when the file size matches header + vertices × stride (binary only). */
  complete: boolean;
}

const PLY_TYPE_SIZE: Record<string, number> = {
  char: 1, uchar: 1, int8: 1, uint8: 1,
  short: 2, ushort: 2, int16: 2, uint16: 2,
  int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4,
  double: 8, float64: 8,
};

/** Parse a PLY header (vertex count + completeness check). */
export async function readPlyInfo(file: string): Promise<PlyInfo | undefined> {
  let fh;
  try {
    fh = await open(file, 'r');
    const { size } = await fh.stat();
    const buf = Buffer.alloc(Math.min(size, 64 * 1024));
    await fh.read(buf, 0, buf.length, 0);
    const text = buf.toString('latin1');
    const end = text.indexOf('end_header');
    if (!text.startsWith('ply') || end < 0) return undefined;
    const nl = text.indexOf('\n', end);
    const headerBytes = nl + 1;
    let vertices = 0;
    let stride = 0;
    let format = '';
    let inVertex = false;
    let elementsAfterVertex = false;
    for (const line of text.slice(0, end).split(/\r?\n/)) {
      const t = line.trim().split(/\s+/);
      if (t[0] === 'format') format = t[1] ?? '';
      else if (t[0] === 'element') {
        if (inVertex) elementsAfterVertex = true;
        inVertex = t[1] === 'vertex';
        if (inVertex) vertices = Number(t[2]) || 0;
      } else if (t[0] === 'property' && inVertex) {
        if (t[1] === 'list') stride = NaN;
        else stride += PLY_TYPE_SIZE[t[1]] ?? NaN;
      }
    }
    const binary = format.startsWith('binary');
    const knownStride = binary && Number.isFinite(stride) && stride > 0 && !elementsAfterVertex;
    const complete = knownStride ? size >= headerBytes + vertices * stride : size > headerBytes;
    return { vertices, headerBytes, stride: knownStride ? stride : 0, format, complete };
  } catch {
    return undefined;
  } finally {
    await fh?.close();
  }
}

/** Shell-quote for POSIX `sh -c`. */
export function shQuote(s: string) {
  return /^[A-Za-z0-9_./=:,+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Strip ANSI escape sequences (progress bars, colors). */
export function stripAnsi(s: string) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b[()][A-Za-z0-9]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}
