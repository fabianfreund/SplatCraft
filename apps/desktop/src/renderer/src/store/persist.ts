/** Tiny localStorage helpers for per-user UI conveniences (never data). */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`sc.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(`sc.${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
