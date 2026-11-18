export function formatBytes(bytes: number | undefined, digits = 1): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : v >= 100 ? 0 : digits)} ${u[i]}`;
}

/** MB → "12.4 GB" style. */
export function formatMB(mb: number | undefined): string {
  return mb === undefined ? '—' : formatBytes(mb * 1024 * 1024);
}

export function formatGB(mb: number | undefined, digits = 1): string {
  return mb === undefined ? '—' : (mb / 1024).toFixed(digits);
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatRelative(iso: string | number | undefined): string {
  if (iso === undefined) return '—';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'Just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** /Users/me/Projects/x → ~/Projects/x */
export function abbreviatePath(p: string): string {
  return p.replace(/^\/(Users|home)\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');
}

export function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

export function formatNumber(v: number | undefined, digits?: number): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (digits !== undefined) return v.toFixed(digits);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  if (a >= 100 || Number.isInteger(v)) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2);
  if (a === 0) return '0';
  return v.toPrecision(3);
}

export function formatStat(v: number | string): string {
  return typeof v === 'number' ? formatNumber(v) : v;
}

/** Words always shown in upper case (acronyms) or expanded. */
const WORDS: Record<string, string> = {
  sh: 'SH', lr: 'LR', psnr: 'PSNR', ssim: 'SSIM', lpips: 'LPIPS', fps: 'FPS', gpu: 'GPU', cpu: 'CPU', vram: 'VRAM', ram: 'RAM',
  sfm: 'SfM', mvs: 'MVS', iou: 'IoU', id: 'ID', ply: 'PLY', spz: 'SPZ', sog: 'SOG', exif: 'EXIF', rgb: 'RGB', mcmc: 'MCMC',
  px: 'px', max: 'Max', min: 'Min', cams: 'cameras', num: 'Number of', iters: 'iterations',
};

/** camelCase / snake_case → "Title case". */
export function humanize(key: string): string {
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => WORDS[w] ?? w);
  const s = words.join(' ');
  return /^[a-z]/.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
