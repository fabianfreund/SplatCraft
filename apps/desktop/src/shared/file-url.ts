import { FILE_PROTOCOL } from './api';

/**
 * `sc-file://local/<encodeURIComponent(absPath)>` — shared by main (protocol
 * handler) and preload (`app.fileUrl`). A query string (e.g. `?v=<step>` for
 * cache-busting live snapshots) is ignored by the handler.
 */
export const FILE_URL_HOST = 'local';

export function toFileUrl(absPath: string): string {
  return `${FILE_PROTOCOL}://${FILE_URL_HOST}/${encodeURIComponent(absPath)}`;
}

/** Inverse of `toFileUrl`; returns undefined for malformed URLs. */
export function fromFileUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.protocol !== `${FILE_PROTOCOL}:` || u.host !== FILE_URL_HOST) return undefined;
    return decodeURIComponent(u.pathname.replace(/^\/+/, ''));
  } catch {
    return undefined;
  }
}
