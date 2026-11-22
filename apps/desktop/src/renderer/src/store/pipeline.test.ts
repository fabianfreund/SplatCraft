import type { PipelineSpec, PlanStep, StageDescriptor } from '@shared/api';
import { describe, expect, it } from 'vitest';
import { effectiveSelectedKey, reduce, reviewStepKey, stepStatus, usePipeline, type StepRuntime } from './pipeline';

const spec: PipelineSpec = {
  preset: 'balanced',
  steps: [
    { key: 'prepare', stageId: 's.prepare', enabled: true, params: {} },
    { key: 'filter', stageId: 's.filter', enabled: true, params: {} },
    { key: 'train', stageId: 's.train', enabled: true, params: {} },
  ],
};
const plan = (cached: boolean[], extra: Partial<PlanStep>[] = []): PlanStep[] =>
  spec.steps.map((s, i) => ({ key: s.key, stageId: s.stageId, hash: `h${i}`, cached: cached[i]!, ...extra[i] }));
const state = (p: PlanStep[], steps: Record<string, StepRuntime> = {}) => ({ ...usePipeline.getState(), spec, plan: p, steps });

describe('stepStatus', () => {
  it('prefers the live runtime, then the cache, then project.json', () => {
    const p = plan([true, false, false], [{}, { last: { stageId: 's.filter', hash: 'old', status: 'complete', runId: 'r', finishedAt: '' } }, { last: { stageId: 's.train', hash: 'h2', status: 'failed', error: 'boom', runId: 'r', finishedAt: '' } }]);
    expect(stepStatus({ plan: p, steps: {} }, 'prepare', true).status).toBe('cached');
    expect(stepStatus({ plan: p, steps: {} }, 'filter', true).status).toBe('stale');
    expect(stepStatus({ plan: p, steps: {} }, 'train', true)).toMatchObject({ status: 'error', error: 'boom' });
    expect(stepStatus({ plan: p, steps: { train: { status: 'running', hash: 'h2' } } }, 'train', true).status).toBe('running');
    expect(stepStatus({ plan: p, steps: {} }, 'train', false).status).toBe('disabled');
  });

  it('ignores a finished runtime whose hash no longer matches the plan (settings changed since)', () => {
    const p = plan([false, false, false]);
    expect(stepStatus({ plan: p, steps: { prepare: { status: 'done', hash: 'before-edit' } } }, 'prepare', true).status).toBe('idle');
  });
});

describe('effectiveSelectedKey', () => {
  it('targets the first step that is not done, unless the user picked one', () => {
    expect(effectiveSelectedKey(state(plan([true, false, false])))).toBe('filter');
    expect(effectiveSelectedKey({ ...state(plan([true, false, false])), selectedKey: 'train' })).toBe('train');
    expect(effectiveSelectedKey(state(plan([true, true, true])))).toBe('train');
  });
});

describe('reduce', () => {
  const started = () => {
    const s0 = usePipeline.getState();
    return { ...s0, ...reduce(s0, { type: 'run.start', runId: 'r', steps: spec.steps.map((s) => ({ key: s.key, stageId: s.stageId, title: s.key })) }) };
  };

  it('queues every step of a run', () => {
    const s = started();
    expect(s.running).toBe(true);
    expect(Object.values(s.steps).map((x) => x.status)).toEqual(['queued', 'queued', 'queued']);
  });

  it('on failure: the running step errors and steps that never started are dropped', () => {
    let s = started();
    s = { ...s, ...reduce(s, { type: 'stage.start', runId: 'r', key: 'prepare', stageId: 's.prepare', hash: 'h0', resume: false }) };
    s = { ...s, ...reduce(s, { type: 'run.done', runId: 'r', status: 'failed', error: 'x' }) };
    expect(s.steps.prepare?.status).toBe('error');
    expect(s.steps.filter).toBeUndefined();
    expect(s.running).toBe(false);
  });

  it('on cancel: running and queued steps become cancelled', () => {
    let s = started();
    s = { ...s, ...reduce(s, { type: 'stage.start', runId: 'r', key: 'prepare', stageId: 's.prepare', hash: 'h0', resume: false }) };
    s = { ...s, ...reduce(s, { type: 'run.done', runId: 'r', status: 'cancelled' }) };
    expect([s.steps.prepare?.status, s.steps.filter?.status]).toEqual(['cancelled', 'cancelled']);
  });
});

describe('reviewStepKey', () => {
  it('finds the step that takes manual frame picks, whatever its id', () => {
    const stages = [
      { id: 's.prepare', paramsJsonSchema: { properties: { fps: {} } } },
      { id: 's.filter', paramsJsonSchema: { properties: { excluded: {} } } },
    ] as unknown as StageDescriptor[];
    expect(reviewStepKey(spec, stages)).toBe('filter');
    expect(reviewStepKey(spec, [])).toBeUndefined();
  });
});
