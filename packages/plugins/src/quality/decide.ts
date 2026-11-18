import { hamming, median, type ImageMetrics } from '../util/image.js';

export type RejectReason = 'blurry' | 'underexposed' | 'overexposed' | 'duplicate' | 'excluded' | 'subsampled';

export interface DecideParams {
  /** Reject frames whose sharpness is below this % of the median sharpness. */
  blurThreshold: number;
  minBrightness: number;
  maxBrightness: number;
  /** Max fraction (0..1) of clipped pixels at either end. */
  maxClipped: number;
  /** dHash Hamming distance (0..64) at or below which a frame is a duplicate (−1 = off). */
  duplicateThreshold: number;
  maxFrames: number;
  excluded: string[];
  included: string[];
}

export interface FrameDecision {
  name: string;
  metrics: ImageMetrics;
  /** Sharpness relative to the median (1 = median). */
  score: number;
  kept: boolean;
  reason?: RejectReason;
  forced?: boolean;
}

/**
 * Pure selection logic (no I/O) so it can be unit-tested.
 * Order: user overrides → exposure → blur (relative) → duplicates → budget.
 */
export function decideFrames(frames: { name: string; metrics: ImageMetrics }[], p: DecideParams): FrameDecision[] {
  const excluded = new Set(p.excluded.map((s) => s.toLowerCase()));
  const included = new Set(p.included.map((s) => s.toLowerCase()));
  const med = median(frames.map((f) => f.metrics.sharpness)) || 1;
  const out: FrameDecision[] = frames.map((f) => ({ ...f, score: f.metrics.sharpness / med, kept: true }));

  let lastKeptHash: string | undefined;
  for (const d of out) {
    const key = d.name.toLowerCase();
    const stem = key.replace(/\.[^.]+$/, '');
    if (included.has(key) || included.has(stem)) {
      d.forced = true;
      lastKeptHash = d.metrics.dhash;
      continue;
    }
    const m = d.metrics;
    if (excluded.has(key) || excluded.has(stem)) d.reason = 'excluded';
    else if (m.brightness < p.minBrightness || m.darkClip > p.maxClipped) d.reason = 'underexposed';
    else if (m.brightness > p.maxBrightness || m.brightClip > p.maxClipped) d.reason = 'overexposed';
    else if (d.score * 100 < p.blurThreshold) d.reason = 'blurry';
    else if (p.duplicateThreshold >= 0 && lastKeptHash && hamming(lastKeptHash, m.dhash) <= p.duplicateThreshold) d.reason = 'duplicate';
    if (d.reason) d.kept = false;
    else lastKeptHash = m.dhash;
  }

  // Budget: split the kept sequence into maxFrames equal bins, keep the sharpest per bin.
  const kept = out.filter((d) => d.kept);
  if (p.maxFrames > 0 && kept.length > p.maxFrames) {
    const forced = kept.filter((d) => d.forced);
    const free = kept.filter((d) => !d.forced);
    const slots = Math.max(0, p.maxFrames - forced.length);
    const keep = new Set<FrameDecision>(forced);
    for (let b = 0; b < slots; b++) {
      const bin = free.slice(Math.floor((b * free.length) / slots), Math.floor(((b + 1) * free.length) / slots));
      if (bin.length) keep.add(bin.reduce((a, c) => (c.metrics.sharpness > a.metrics.sharpness ? c : a)));
    }
    for (const d of kept) if (!keep.has(d)) {
      d.kept = false;
      d.reason = 'subsampled';
    }
  }
  return out;
}
