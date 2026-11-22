/**
 * Feature points: the user clicks the same spot in several frames (a track).
 * Tracks are stored in the params of whichever step declares a `tiePoints`
 * param (COLMAP today), so the renderer stays workflow-agnostic and that step
 * re-runs when they change. Positions are fractions of the image size.
 */
import type { PipelineSpec, StageDescriptor } from '@shared/api';
import { create } from 'zustand';
import { descriptorFor, usePipeline } from './pipeline';

export const TIE_PARAM = 'tiePoints';

export interface TiePoint {
  image: string;
  x: number;
  y: number;
}
export interface TieTrack {
  id: number;
  points: TiePoint[];
}

/** Key of the step that takes feature points (has a `tiePoints` param). */
export function tieStepKey(spec: PipelineSpec | null, stages: StageDescriptor[]): string | undefined {
  return spec?.steps.find((st) => {
    const schema = descriptorFor(stages, st.stageId)?.paramsJsonSchema as { properties?: Record<string, unknown> } | undefined;
    return !!schema?.properties && TIE_PARAM in schema.properties;
  })?.key;
}

const valid = (t: unknown): t is TieTrack =>
  !!t && typeof t === 'object' && typeof (t as TieTrack).id === 'number' && Array.isArray((t as TieTrack).points);

/** Current tracks of the feature-point step. */
export function currentTracks(spec: PipelineSpec | null, stages: StageDescriptor[]): TieTrack[] {
  const key = tieStepKey(spec, stages);
  const raw = spec?.steps.find((s) => s.key === key)?.params[TIE_PARAM];
  return Array.isArray(raw) ? raw.filter(valid) : [];
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** Sets (adds or moves) the track's point in `image`. */
export function placePoint(tracks: readonly TieTrack[], id: number, image: string, x: number, y: number): TieTrack[] {
  const p: TiePoint = { image, x: clamp(x), y: clamp(y) };
  if (!tracks.some((t) => t.id === id)) return [...tracks, { id, points: [p] }];
  return tracks.map((t) => (t.id === id ? { ...t, points: [...t.points.filter((q) => q.image !== image), p] } : t));
}

/** Removes the track's point in `image`; a track without points disappears. */
export function removePoint(tracks: readonly TieTrack[], id: number, image: string): TieTrack[] {
  return tracks.map((t) => (t.id === id ? { ...t, points: t.points.filter((q) => q.image !== image) } : t)).filter((t) => t.points.length > 0);
}

export const nextTrackId = (tracks: readonly TieTrack[]) => tracks.reduce((m, t) => Math.max(m, t.id), 0) + 1;

/** Number of feature points per frame. */
export function pointCounts(tracks: readonly TieTrack[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tracks) for (const p of t.points) out.set(p.image, (out.get(p.image) ?? 0) + 1);
  return out;
}

/** Tracks that count for alignment (seen in at least two frames). */
export const usableTracks = (tracks: readonly TieTrack[]) => tracks.filter((t) => new Set(t.points.map((p) => p.image)).size >= 2);

function write(tracks: TieTrack[]) {
  const p = usePipeline.getState();
  const key = tieStepKey(p.spec, p.stages);
  const st = p.spec?.steps.find((s) => s.key === key);
  if (!key || !st) return;
  const params = { ...st.params };
  // None → unset, so the step's cache key goes back to what it was without points.
  if (tracks.length) params[TIE_PARAM] = tracks;
  else delete params[TIE_PARAM];
  p.updateStep(key, { params });
}

const tracksNow = () => {
  const p = usePipeline.getState();
  return currentTracks(p.spec, p.stages);
};

interface TiePointsState {
  /** Feature-point mode: clicks in the image preview place points. */
  active: boolean;
  /** The point (track) being placed; undefined = the next click starts a new one. */
  track?: number;
  setActive(active: boolean): void;
  selectTrack(id: number | undefined): void;
  /**
   * A click on empty image space: places the selected point in this frame, or starts
   * a new point when there is none selected or it is already in this frame.
   */
  click(image: string, x: number, y: number): void;
  move(id: number, image: string, x: number, y: number): void;
  remove(id: number, image: string): void;
  deleteTrack(id: number): void;
  clear(): void;
}

export const useTiePoints = create<TiePointsState>()((set, get) => ({
  active: false,
  setActive: (active) => set({ active }),
  selectTrack: (track) => set({ track }),
  click(image, x, y) {
    const tracks = tracksNow();
    const sel = tracks.find((t) => t.id === get().track);
    const id = sel && !sel.points.some((p) => p.image === image) ? sel.id : nextTrackId(tracks);
    write(placePoint(tracks, id, image, x, y));
    set({ track: id });
  },
  move(id, image, x, y) {
    write(placePoint(tracksNow(), id, image, x, y));
    set({ track: id });
  },
  remove(id, image) {
    const next = removePoint(tracksNow(), id, image);
    write(next);
    if (!next.some((t) => t.id === id) && get().track === id) set({ track: undefined });
  },
  deleteTrack(id) {
    write(tracksNow().filter((t) => t.id !== id));
    if (get().track === id) set({ track: undefined });
  },
  clear() {
    write([]);
    set({ track: undefined });
  },
}));
