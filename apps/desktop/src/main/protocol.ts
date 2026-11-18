import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { FILE_PROTOCOL } from '@shared/api';
import { fromFileUrl } from '@shared/file-url';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ply': 'application/octet-stream',
  '.spz': 'application/octet-stream',
  '.splat': 'application/octet-stream',
  '.ksplat': 'application/octet-stream',
  '.sog': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

export function mimeFor(file: string) {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** Must run before `app.whenReady()`. */
export function registerFileSchemePrivileges() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FILE_PROTOCOL,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ]);
}

export function isInside(child: string, root: string) {
  const rel = path.relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function real(p: string) {
  try {
    return await realpath(p);
  } catch {
    return undefined;
  }
}

/**
 * Serves local files to the renderer. Only files inside `allowedRoots()`
 * (project dir, userData, recent projects, linked sources) are reachable;
 * symlinks and `..` are resolved before the check.
 */
export function handleFileProtocol(allowedRoots: () => string[]) {
  protocol.handle(FILE_PROTOCOL, async (req) => {
    const raw = fromFileUrl(req.url);
    if (!raw || !path.isAbsolute(raw)) return text(400, 'Bad request');
    const file = await real(path.resolve(raw));
    if (!file) return text(404, 'Not found');

    const roots = (await Promise.all(allowedRoots().map(async (r) => (await real(r)) ?? path.resolve(r)))).filter(Boolean);
    if (!roots.some((r) => isInside(file, r))) return text(403, 'Forbidden');

    let st;
    try {
      st = await stat(file);
    } catch {
      return text(404, 'Not found');
    }
    if (!st.isFile()) return text(404, 'Not a file');

    const headers: Record<string, string> = {
      'Content-Type': mimeFor(file),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Last-Modified': st.mtime.toUTCString(),
    };

    const range = req.headers.get('range');
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!m || (!m[1] && !m[2])) return text(416, 'Bad range', { 'Content-Range': `bytes */${st.size}` });
      let start: number;
      let end: number;
      if (!m[1]) {
        // suffix range: last N bytes
        start = Math.max(0, st.size - Number(m[2]));
        end = st.size - 1;
      } else {
        start = Number(m[1]);
        end = m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      }
      if (start > end || start >= st.size) return text(416, 'Range not satisfiable', { 'Content-Range': `bytes */${st.size}` });
      return new Response(stream(file, start, end), {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(end - start + 1) },
      });
    }

    if (req.method === 'HEAD') return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': String(st.size) } });
    return new Response(stream(file), { status: 200, headers: { ...headers, 'Content-Length': String(st.size) } });
  });
}

function stream(file: string, start?: number, end?: number) {
  return Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream;
}

function text(status: number, body: string, extra: Record<string, string> = {}) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*', ...extra } });
}
