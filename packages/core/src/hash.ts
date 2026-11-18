import { createHash } from 'node:crypto';

/** Deterministic JSON (sorted keys) so hashes don't depend on key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function hashOf(...parts: unknown[]): string {
  const h = createHash('sha256');
  for (const p of parts) h.update(stableStringify(p)).update('\u0000');
  return h.digest('hex').slice(0, 16);
}
