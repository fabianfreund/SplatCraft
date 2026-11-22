import { useMemo } from 'react';
import { basename } from '../../lib/format';
import { reviewStepKey, usePipeline, type FrameScore } from '../../store/pipeline';

export interface FrameItem {
  path: string;
  name: string;
  score?: number;
  kept: boolean;
  reason?: string;
  overridden: boolean;
}

/** Frames from previews merged with manual include/exclude overrides. */
export function useFrames() {
  const images = usePipeline((s) => s.previews.images);
  const scores = usePipeline((s) => s.previews.frameScores);
  const spec = usePipeline((s) => s.spec);
  const stages = usePipeline((s) => s.stages);
  const updateStep = usePipeline((s) => s.updateStep);
  const qKey = reviewStepKey(spec, stages);
  const qStep = spec?.steps.find((s) => s.key === qKey);
  const excluded = useMemo(() => new Set((qStep?.params.excluded as string[] | undefined) ?? []), [qStep]);
  const included = useMemo(() => new Set((qStep?.params.included as string[] | undefined) ?? []), [qStep]);

  const items: FrameItem[] = useMemo(() => {
    const src: FrameScore[] = scores?.items ?? (images?.paths ?? []).map((p) => ({ path: p, score: NaN, kept: true }));
    return src.map((f) => {
      const name = basename(f.path);
      const ex = excluded.has(name);
      const inc = included.has(name);
      const kept = ex ? false : inc ? true : f.kept;
      return {
        path: f.path,
        name,
        score: Number.isFinite(f.score) ? f.score : undefined,
        kept,
        reason: kept ? undefined : ex ? 'excluded' : (f.reason ?? 'rejected'),
        overridden: ex || inc,
      };
    });
  }, [scores, images, excluded, included]);

  /** What the filter decided on its own (a manual exclusion counts as "kept"). */
  const algoKept = (name: string) => {
    const it = scores?.items.find((x) => basename(x.path) === name);
    return !it || it.reason === 'excluded' ? true : it.kept;
  };

  const toggle = (f: FrameItem) => {
    // Read the latest spec (not the render closure) so rapid clicks compose.
    const cur = usePipeline.getState().spec?.steps.find((s) => s.key === qKey);
    if (!cur || !qKey) return;
    const ex = new Set((cur.params.excluded as string[] | undefined) ?? []);
    const inc = new Set((cur.params.included as string[] | undefined) ?? []);
    if (f.kept) {
      inc.delete(f.name);
      if (algoKept(f.name)) ex.add(f.name);
    } else {
      ex.delete(f.name);
      if (!algoKept(f.name)) inc.add(f.name);
    }
    const params: Record<string, unknown> = { ...cur.params, excluded: [...ex], included: [...inc] };
    if (!ex.size) delete params.excluded;
    if (!inc.size) delete params.included;
    updateStep(qKey, { params }); // optimistic: tiles re-derive from the spec instantly
    usePipeline.getState().scheduleReview();
  };

  const kept = items.filter((i) => i.kept).length;
  return { items, toggle, kept, rejected: items.length - kept, canToggle: !!qKey && !!scores };
}
