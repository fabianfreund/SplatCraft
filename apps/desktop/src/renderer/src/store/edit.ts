/**
 * Edit tools on the 3D view: pick a ground plane (3 points) and a scale
 * reference (2 points + a real length). The result is a `SceneAlignment`
 * stored in the params of whichever step declares an `alignment` param, so the
 * renderer stays workflow-agnostic and the cache re-exports when it changes.
 */
import type { PipelineSpec, StageDescriptor } from '@shared/api';
import { orientTowards, type GroundPlane, type LengthUnit, type SceneAlignment, type ScaleReference, type Vec3 } from '@splatcraft/core/alignment';
import type { PickHit } from '../viewer/ViewerAPI';
import { create } from 'zustand';
import { load, save } from './persist';
import { descriptorFor, usePipeline } from './pipeline';

export type EditTool = 'ground' | 'measure';
export type Overlay = 'ground' | 'scale';

/** Points each tool needs. */
export const TOOL_POINTS: Record<EditTool, number> = { ground: 3, measure: 2 };

export const ALIGNMENT_PARAM = 'alignment';

/** Key of the step that owns the scene alignment (has an `alignment` param). */
export function alignmentStepKey(spec: PipelineSpec | null, stages: StageDescriptor[]): string | undefined {
  return spec?.steps.find((st) => {
    const schema = descriptorFor(stages, st.stageId)?.paramsJsonSchema as { properties?: Record<string, unknown> } | undefined;
    return !!schema?.properties && ALIGNMENT_PARAM in schema.properties;
  })?.key;
}

/** Current alignment from the pipeline store. */
export function currentAlignment(): SceneAlignment | undefined {
  const { spec, stages } = usePipeline.getState();
  const key = alignmentStepKey(spec, stages);
  return key ? (spec?.steps.find((s) => s.key === key)?.params[ALIGNMENT_PARAM] as SceneAlignment | undefined) : undefined;
}

function writeAlignment(next: SceneAlignment) {
  const p = usePipeline.getState();
  const key = alignmentStepKey(p.spec, p.stages);
  const st = p.spec?.steps.find((s) => s.key === key);
  if (!key || !st) return;
  const params = { ...st.params };
  const clean: SceneAlignment = { ...(next.ground ? { ground: next.ground } : {}), ...(next.scale ? { scale: next.scale } : {}) };
  if (clean.ground || clean.scale) params[ALIGNMENT_PARAM] = clean;
  else delete params[ALIGNMENT_PARAM];
  p.updateStep(key, { params });
}

interface EditState {
  tool: EditTool | null;
  /** Points picked so far with the active tool (file coordinates). */
  draft: Vec3[];
  /** Camera positions the draft points were picked from. */
  eyes: Vec3[];
  /** Two measure points waiting for their real length. */
  pendingScale?: { a: Vec3; b: Vec3 };
  /** Last unit the user typed a length in. */
  unit: LengthUnit;
  /** Which saved overlays are drawn in the 3D view. */
  overlays: Record<Overlay, boolean>;
  toggleOverlay(k: Overlay): void;
  setTool(tool: EditTool | null): void;
  addPoint(hit: PickHit): void;
  /** Remove the last picked point (or leave the tool when there is none). */
  undoPoint(): void;
  confirmScale(distance: number, unit: LengthUnit): void;
  cancel(): void;
  setGround(ground: GroundPlane | undefined): void;
  setScale(scale: ScaleReference | undefined): void;
}

export const useEdit = create<EditState>()((set, get) => ({
  tool: null,
  draft: [],
  eyes: [],
  unit: load<LengthUnit>('editUnit', 'cm'),
  overlays: load<Record<Overlay, boolean>>('editOverlays', { ground: true, scale: true }),
  toggleOverlay(k) {
    const overlays = { ...get().overlays, [k]: !get().overlays[k] };
    save('editOverlays', overlays);
    set({ overlays });
  },
  setTool: (tool) => set({ tool, draft: [], eyes: [], pendingScale: undefined }),
  addPoint({ point, eye }) {
    const { tool, draft, eyes } = get();
    if (!tool) return;
    const pts = [...draft, point];
    const seen = [...eyes, eye];
    if (pts.length < TOOL_POINTS[tool]) return set({ draft: pts, eyes: seen });
    if (tool === 'ground') {
      // Up is the side the user looked at the floor from.
      const mean = seen.reduce<Vec3>((a, e) => [a[0] + e[0] / seen.length, a[1] + e[1] / seen.length, a[2] + e[2] / seen.length], [0, 0, 0]);
      get().setGround({ points: orientTowards(pts as [Vec3, Vec3, Vec3], mean) });
      set({ tool: null, draft: [], eyes: [] });
    } else {
      set({ draft: pts, pendingScale: { a: pts[0], b: pts[1] } });
    }
  },
  undoPoint() {
    const { draft, pendingScale } = get();
    const eyes = get().eyes.slice(0, -1);
    if (pendingScale) return set({ pendingScale: undefined, draft: draft.slice(0, -1), eyes });
    if (draft.length) set({ draft: draft.slice(0, -1), eyes });
    else set({ tool: null });
  },
  confirmScale(distance, unit) {
    const s = get().pendingScale;
    if (!s || !(distance > 0)) return;
    save('editUnit', unit);
    get().setScale({ a: s.a, b: s.b, distance, unit });
    set({ tool: null, draft: [], eyes: [], pendingScale: undefined, unit });
  },
  cancel: () => set({ tool: null, draft: [], eyes: [], pendingScale: undefined }),
  setGround: (ground) => writeAlignment({ ...currentAlignment(), ground }),
  setScale: (scale) => writeAlignment({ ...currentAlignment(), scale }),
}));
