import type { PipelineSpec, PresetId, StageDescriptor } from '@shared/api';
import { fieldsFromSchema, type FieldSpec } from '../../lib/schema';

/** The first enabled step that consumes imported media (`sources`), with its descriptor. */
export function sourceStep(stages: StageDescriptor[], spec: PipelineSpec | null) {
  for (const step of spec?.steps ?? []) {
    if (!step.enabled) continue;
    const descriptor = stages.find((d) => d.id === step.stageId);
    if (descriptor?.inputs.includes('sources')) return { ...step, descriptor };
  }
  return undefined;
}

/** Effective value of a param: user override → preset → schema default. */
export function paramValue(d: StageDescriptor, preset: PresetId, params: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(params, key)) return params[key];
  const fromPreset = d.presets[preset]?.[key];
  if (fromPreset !== undefined) return fromPreset;
  return fieldsFromSchema(d.paramsJsonSchema).find((f) => f.key === key)?.default;
}

/**
 * Params shown in Simple mode, by well-known name. A stage that has none of
 * them simply shows nothing here; everything stays reachable under Details.
 */
const KEY_PARAMS = ['fps'] as const;

export function keyFields(d: StageDescriptor): FieldSpec[] {
  const fields = fieldsFromSchema(d.paramsJsonSchema);
  return KEY_PARAMS.map((k) => fields.find((f) => f.key === k && (f.kind === 'number' || f.kind === 'integer'))).filter((f): f is FieldSpec => !!f);
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Expected frames: Σ (trimmed video seconds × fps, capped per video) + photos.
 * Returns undefined when the step has no `fps`; `partial` when a video's duration is unknown.
 */
export function estimateFrames(
  items: { kind: string; duration?: number; trim?: { start: number; end?: number } }[],
  d: StageDescriptor | undefined,
  preset: PresetId,
  params: Record<string, unknown>,
): { frames: number; partial: boolean } | undefined {
  if (!d) return undefined;
  const fps = num(paramValue(d, preset, params, 'fps'));
  const cap = num(paramValue(d, preset, params, 'maxFramesPerVideo')) ?? 0;
  let frames = 0;
  let partial = false;
  for (const i of items) {
    if (i.kind === 'image') frames++;
    if (i.kind !== 'video') continue;
    if (fps === undefined) return undefined;
    const len = trimmedLength(i.duration, i.trim);
    if (len === undefined) {
      partial = true;
      continue;
    }
    const n = Math.max(1, Math.round(len * fps));
    frames += cap > 0 ? Math.min(cap, n) : n;
  }
  return { frames, partial };
}

/** Seconds of a clip that will be used. */
export function trimmedLength(duration: number | undefined, trim?: { start: number; end?: number }): number | undefined {
  const end = trim?.end ?? duration;
  if (end === undefined) return undefined;
  return Math.max(0, end - (trim?.start ?? 0));
}
