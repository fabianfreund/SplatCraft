import type { StageDescriptor } from '@shared/api';
import { formatNumber } from './format';

const SHORT: Record<string, string> = {
  prepare: 'Media',
  filter: 'Prepare',
  align: 'Align',
  train: 'Train',
  refine: 'Refine',
  export: 'Edit',
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

/** What the workspace shows for a step: which view, and what that view displays. */
export interface StepFocus {
  tab: 'gallery' | 'viewer';
  /** Gallery content: the input media or the extracted / reviewed frames. */
  gallery?: 'sources' | 'frames';
  /** Viewer layers to show. */
  layers?: { points: boolean; cameras: boolean; splat: boolean };
}

/**
 * Per-category focus. Workflows stay data-driven: a new stage category only
 * needs an entry here (unknown categories fall back to the gallery).
 */
const FOCUS: Record<string, StepFocus> = {
  prepare: { tab: 'gallery', gallery: 'sources' },
  filter: { tab: 'gallery', gallery: 'frames' },
  align: { tab: 'viewer', layers: { points: true, cameras: true, splat: false } },
  train: { tab: 'viewer', layers: { points: false, cameras: false, splat: true } },
  refine: { tab: 'viewer', layers: { points: false, cameras: false, splat: true } },
  export: { tab: 'viewer', layers: { points: false, cameras: false, splat: true } },
};

export function focusFor(category: string | undefined): StepFocus {
  return (category && FOCUS[category]) || { tab: 'gallery', gallery: 'frames' };
}
