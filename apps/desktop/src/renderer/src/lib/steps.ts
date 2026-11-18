import type { StageDescriptor } from '@shared/api';
import { formatNumber } from './format';

const SHORT: Record<string, string> = {
  prepare: 'Media',
  filter: 'Review',
  align: 'Align',
  train: 'Train',
  refine: 'Refine',
  export: 'Export',
};

/** Short stepper title derived from the stage category. */
export function shortTitle(d: StageDescriptor | undefined, fallback: string): string {
  return (d && SHORT[d.category]) ?? d?.title ?? fallback;
}

const n = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** One compact key figure per step for the stepper. */
export function keyStat(category: string | undefined, stats: Record<string, number | string> | undefined): string | undefined {
  if (!stats) return undefined;
  switch (category) {
    case 'prepare':
      return n(stats.frames) !== undefined ? `${n(stats.frames)}` : undefined;
    case 'filter':
      return n(stats.kept) !== undefined && n(stats.frames) !== undefined ? `${n(stats.kept)}/${n(stats.frames)}` : undefined;
    case 'align': {
      const r = n(stats.registeredImages);
      return r !== undefined ? `${r} cams` : typeof stats.registered === 'string' ? stats.registered : undefined;
    }
    case 'train':
    case 'refine':
      return n(stats.splats) !== undefined ? compact(n(stats.splats)!) : undefined;
    case 'export':
      return n(stats.sizeMB) !== undefined ? `${Math.round(n(stats.sizeMB)!)} MB` : typeof stats.size === 'string' ? stats.size : undefined;
  }
  const first = Object.values(stats)[0];
  return first === undefined ? undefined : typeof first === 'number' ? formatNumber(first) : first;
}

function compact(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`;
  return `${v}`;
}
