import type { EngineEvent, LatestPreview, NoticeEntry, OpenProject, PipelineSpec, PlanStep, PresetId, ProjectMeta, StageDescriptor, StageNotice } from '@shared/api';
import { create } from 'zustand';
import type { StepStatus } from '../ui/Badge';
import { useApp } from './app';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface StepRuntime {
  status: Exclude<StepStatus, 'disabled' | 'idle'>;
  hash?: string;
  fraction?: number;
  message?: string;
  startedAt?: number;
  durationMs?: number;
  stats?: Record<string, number | string>;
  error?: string;
  resume?: boolean;
}

export interface LogLine {
  id: number;
  t: number;
  key: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  line: string;
}

export interface MetricPoint {
  step: number;
  value: number;
  key: string;
}

export interface FrameScore {
  path: string;
  score: number;
  kept: boolean;
  reason?: string;
}

export interface Previews {
  images?: { key: string; paths: string[] };
  frameScores?: { key: string; items: FrameScore[] };
  pointcloud?: { key: string; path: string; points?: number; v: number };
  cameras?: { key: string; cameras: { name: string; position: [number, number, number]; quaternion: [number, number, number, number] }[]; v: number };
  splat?: { key: string; path: string; step?: number; v: number };
}

export interface NoticeItem {
  /** Stable id (for read/dismissed state). */
  id: string;
  key: string;
  stageId: string;
  at: string;
  notice: StageNotice;
}

const noticeId = (key: string, at: string, n: StageNotice) => `${key}|${at}|${n.level}|${n.title}`;
const cachedItems = (key: string, stageId: string, ns: StageNotice[] | undefined): NoticeItem[] =>
  (ns ?? []).map((notice) => ({ id: noticeId(key, 'cached', notice), key, stageId, at: '', notice }));

const LOG_CAP = 4000;

interface PipelineState {
  stages: StageDescriptor[];
  stagesLoaded: boolean;
  plan: PlanStep[];
  spec: PipelineSpec | null;

  runId?: string;
  running: boolean;
  stopping: boolean;
  runStartedAt?: number;
  runEndedAt?: number;
  runStatus?: 'completed' | 'cancelled' | 'failed';
  runError?: string;
  runSteps: { key: string; stageId: string; title: string }[];
  steps: Record<string, StepRuntime>;
  logs: LogLine[];
  metrics: Record<string, MetricPoint[]>;
  previews: Previews;
  /** User-selected step (target of "Run step"); undefined = automatic. */
  selectedKey?: string;
  /** Which top-bar button started the current run (its slot turns into Stop). */
  runOrigin?: 'step' | 'all';
  /** A review re-run is queued (frame toggles while a run was busy). */
  reviewQueued: boolean;
  /** Notices per step key (live run, cached results, or the latest run after restart). */
  notices: Record<string, NoticeItem[]>;
  /** The error that ended the latest run, if it failed. */
  failure?: NoticeItem;

  loadForProject(p: OpenProject): Promise<void>;
  syncSpec(meta: ProjectMeta): void;
  reset(): void;
  refreshPlan(): Promise<void>;
  apply(e: EngineEvent): void;
  applyMany(es: EngineEvent[]): void;
  setSpec(spec: PipelineSpec): void;
  updateStep(key: string, patch: Partial<PipelineSpec['steps'][number]>): void;
  setPreset(preset: PresetId): Promise<void>;
  run(opts?: { untilKey?: string; force?: string[] }, origin?: 'step' | 'all'): Promise<void>;
  /** Run up to the quality (review) step. */
  runReview(): Promise<void>;
  /** Debounced review re-run after frame toggles. */
  scheduleReview(): void;
  /** Persist a pending debounced spec edit now. */
  flushSpec(): Promise<void>;
  seedPreviews(list: LatestPreview[], onlyMissing?: boolean): void;
  selectStep(key: string | undefined): void;
  seedNotices(): Promise<void>;
  cancel(): Promise<void>;
  clearLogs(): void;
}

const api = () => window.splatcraft;
let logSeq = 0;
let previewSeq = 0;
let updateTimer: number | undefined;
let pendingSpec: PipelineSpec | undefined;
let reviewTimer: number | undefined;

const emptyRun = {
  notices: {},
  failure: undefined,
  selectedKey: undefined,
  runOrigin: undefined,
  reviewQueued: false,
  runId: undefined,
  running: false,
  stopping: false,
  runStartedAt: undefined,
  runEndedAt: undefined,
  runStatus: undefined,
  runError: undefined,
  runSteps: [],
  steps: {},
  logs: [],
  metrics: {},
  previews: {},
};

/* ------------------------------------------------------------------ */
/* Reducer: EngineEvent → state                                        */
/* ------------------------------------------------------------------ */

export function reduce(s: PipelineState, e: EngineEvent): Partial<PipelineState> {
  const now = Date.now();
  const step = (key: string, patch: Partial<StepRuntime>): Record<string, StepRuntime> => ({
    ...s.steps,
    [key]: { ...(s.steps[key] ?? { status: 'queued' }), ...patch } as StepRuntime,
  });
  switch (e.type) {
    case 'run.start': {
      const steps = { ...s.steps };
      for (const st of e.steps) steps[st.key] = { status: 'queued' };
      return {
        runId: e.runId,
        running: true,
        stopping: false,
        runStartedAt: now,
        runEndedAt: undefined,
        runStatus: undefined,
        runError: undefined,
        runSteps: e.steps,
        steps,
        metrics: {},
        failure: undefined,
      };
    }
    case 'stage.start':
      return { notices: { ...s.notices, [e.key]: [] }, steps: step(e.key, { status: 'running', hash: e.hash, startedAt: now, fraction: 0, message: undefined, error: undefined, resume: e.resume }) };
    case 'stage.progress':
      return {
        steps: step(e.key, {
          status: 'running',
          fraction: e.fraction ?? s.steps[e.key]?.fraction,
          message: e.message ?? s.steps[e.key]?.message,
        }),
      };
    case 'stage.cached':
      return {
        steps: step(e.key, { status: 'cached', hash: e.hash, stats: e.stats, fraction: 1 }),
        notices: { ...s.notices, [e.key]: cachedItems(e.key, e.stageId, e.notices) },
      };
    case 'stage.notice': {
      const item: NoticeItem = { id: noticeId(e.key, e.at, e.notice), key: e.key, stageId: e.stageId, at: e.at, notice: e.notice };
      const list = (s.notices[e.key] ?? []).filter((x) => x.id !== item.id);
      return { notices: { ...s.notices, [e.key]: [...list, item] }, ...(e.notice.level === 'error' ? { failure: item } : {}) };
    }
    case 'stage.done':
      return { steps: step(e.key, { status: 'done', durationMs: e.durationMs, stats: e.stats, fraction: 1, message: undefined }) };
    case 'stage.error': {
      // The engine also posts an error notice; synthesize one for older engines.
      const has = (s.notices[e.key] ?? []).some((x) => x.notice.level === 'error');
      const at = new Date(now).toISOString();
      const notice: StageNotice = { level: 'error', title: e.error };
      const item: NoticeItem = { id: noticeId(e.key, at, notice), key: e.key, stageId: e.stageId, at, notice };
      return {
        steps: step(e.key, { status: 'error', error: e.error }),
        ...(has ? {} : { notices: { ...s.notices, [e.key]: [...(s.notices[e.key] ?? []), item] }, failure: item }),
      };
    }
    case 'stage.log': {
      const logs = s.logs.length >= LOG_CAP ? s.logs.slice(-LOG_CAP + 500) : s.logs.slice();
      logs.push({ id: ++logSeq, t: now, key: e.key, level: e.level, line: e.line });
      return { logs };
    }
    case 'stage.metric': {
      const metrics = { ...s.metrics };
      for (const [name, value] of Object.entries(e.values)) {
        if (!Number.isFinite(value)) continue;
        metrics[name] = [...(metrics[name] ?? []), { step: e.step, value, key: e.key }];
      }
      return { metrics };
    }
    case 'stage.preview': {
      const p = e.preview;
      const v = ++previewSeq;
      switch (p.kind) {
        case 'images': {
          const prev = s.previews.images?.key === e.key && p.append ? s.previews.images.paths : [];
          return { previews: { ...s.previews, images: { key: e.key, paths: [...prev, ...p.paths] } } };
        }
        case 'frameScores':
          return { previews: { ...s.previews, frameScores: { key: e.key, items: p.items } } };
        case 'pointcloud':
          return { previews: { ...s.previews, pointcloud: { key: e.key, path: p.path, points: p.points, v } } };
        case 'cameras':
          return { previews: { ...s.previews, cameras: { key: e.key, cameras: p.cameras, v } } };
        case 'splat':
          return { previews: { ...s.previews, splat: { key: e.key, path: p.path, step: p.step, v } } };
        default:
          return {};
      }
    }
    case 'run.done': {
      const steps = { ...s.steps };
      for (const [k, st] of Object.entries(steps)) {
        if (st.status === 'running') steps[k] = { ...st, status: e.status === 'failed' ? 'error' : 'cancelled' };
        // Steps that never started after a failure are simply not done.
        else if (st.status === 'queued') {
          if (e.status === 'failed') delete steps[k];
          else steps[k] = { ...st, status: 'cancelled' };
        }
      }
      return { running: false, stopping: false, runStatus: e.status, runError: e.error, runEndedAt: now, steps };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export const usePipeline = create<PipelineState>()((set, get) => ({
  stages: [],
  stagesLoaded: false,
  plan: [],
  spec: null,
  ...emptyRun,

  async loadForProject(p) {
    set({ ...emptyRun, spec: p.meta.pipeline, plan: [] });
    const [stages, state, latest] = await Promise.all([api().pipeline.stages(), api().pipeline.state(), api().pipeline.latestPreviews().catch(() => [])]);
    set({ stages, stagesLoaded: true });
    get().seedPreviews(latest);
    // Rehydrate: replay the latest events so a reload shows the live run.
    get().applyMany(state.lastEvents);
    if (state.runningRunId && !get().running) set({ running: true, runId: state.runningRunId });
    // Reopened project: show the last cached splat / point cloud / cameras.
    const pv = get().previews;
    if (!state.runningRunId && !pv.splat && !pv.pointcloud && !pv.cameras) {
      try {
        const latest = await api().pipeline.latestPreviews();
        get().applyMany(latest.map((l) => ({ type: 'stage.preview' as const, runId: '', key: l.key, preview: l.preview })));
      } catch {
        /* previews are best-effort */
      }
    }
    await get().refreshPlan();
    await get().seedNotices();
  },
  async seedNotices() {
    const [entries, runs] = await Promise.all([api().pipeline.notices().catch((): NoticeEntry[] => []), api().pipeline.runs().catch(() => [])]);
    set((s) => {
      const notices: Record<string, NoticeItem[]> = { ...s.notices };
      // Cached steps: notices stored with the cached result.
      for (const p of s.plan) if (p.cached && p.notices?.length && !notices[p.key]?.length) notices[p.key] = cachedItems(p.key, p.stageId, p.notices);
      // Not-cached steps (e.g. the one that failed): notices of the latest run.
      for (const e of entries) {
        if (s.plan.find((p) => p.key === e.key)?.cached) continue;
        const item: NoticeItem = { id: noticeId(e.key, e.at, e.notice), key: e.key, stageId: e.stageId, at: e.at, notice: e.notice };
        const list = notices[e.key] ?? [];
        if (!list.some((x) => x.id === item.id)) notices[e.key] = [...list, item];
      }
      const latest = runs[0];
      const failure =
        s.failure ?? (latest?.status === 'failed' ? [...entries].reverse().map((e) => notices[e.key]?.find((x) => x.notice.level === 'error')).find(Boolean) : undefined);
      return { notices, failure };
    });
  },
  syncSpec(meta) {
    // Ignore echoes while a local edit is pending to avoid clobbering typing.
    if (updateTimer === undefined) set({ spec: meta.pipeline });
  },
  reset() {
    set({ ...emptyRun, spec: null, plan: [] });
  },
  async refreshPlan() {
    try {
      set({ plan: await api().pipeline.plan() });
    } catch {
      set({ plan: [] });
    }
  },
  apply(e) {
    set((s) => reduce(s, e));
    if (e.type === 'run.done' || e.type === 'stage.done' || e.type === 'stage.cached') void get().refreshPlan();
    if (e.type === 'run.done') {
      set({ runOrigin: undefined });
      void api()
        .pipeline.latestPreviews()
        .then((l) => get().seedPreviews(l, true))
        .catch(() => {});
      if (get().reviewQueued) {
        set({ reviewQueued: false });
        get().scheduleReview();
      }
    }
  },
  applyMany(es) {
    if (!es.length) return;
    set((s) => {
      let acc: PipelineState = s;
      for (const e of es) acc = { ...acc, ...reduce(acc, e) };
      return acc;
    });
  },
  setSpec(spec) {
    set({ spec });
    pendingSpec = spec;
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(() => void get().flushSpec(), 450);
  },
  async flushSpec() {
    window.clearTimeout(updateTimer);
    const spec = pendingSpec;
    pendingSpec = undefined;
    if (!spec) {
      updateTimer = undefined;
      return;
    }
    try {
      const meta = await api().pipeline.update(spec);
      updateTimer = undefined;
      useApp.getState().setMeta(meta);
    } catch (err) {
      updateTimer = undefined;
      useApp.getState().setError(String((err as Error).message ?? err));
    }
    void get().refreshPlan();
  },
  updateStep(key, patch) {
    const spec = get().spec;
    if (!spec) return;
    get().setSpec({ ...spec, steps: spec.steps.map((st) => (st.key === key ? { ...st, ...patch } : st)) });
  },
  async setPreset(preset) {
    const spec = get().spec;
    if (spec) set({ spec: { ...spec, preset } });
    const meta = await api().pipeline.setPreset(preset);
    useApp.getState().setMeta(meta);
    void get().refreshPlan();
  },
  async run(opts, origin = 'all') {
    try {
      await get().flushSpec();
      set({ runOrigin: origin });
      const { runId } = await api().pipeline.run(opts);
      if (!get().running) set({ runId, running: true });
    } catch (err) {
      set({ runOrigin: undefined });
      useApp.getState().setError(String((err as Error).message ?? err));
    }
  },
  async runReview() {
    const key = qualityStepKey(get().spec);
    const st = get().spec?.steps.find((x) => x.key === key);
    if (!key || !st?.enabled) return;
    if (get().running) {
      set({ reviewQueued: true });
      return;
    }
    await get().run({ untilKey: key }, 'step');
  },
  scheduleReview() {
    window.clearTimeout(reviewTimer);
    reviewTimer = window.setTimeout(() => void get().runReview(), 600);
  },
  seedPreviews(list, onlyMissing = false) {
    if (!list.length) return;
    set((s) => {
      const previews: Previews = { ...s.previews };
      for (const l of list) {
        const p = l.preview;
        if (onlyMissing && previews[p.kind as keyof Previews]) continue;
        const v = ++previewSeq;
        if (p.kind === 'images') previews.images = { key: l.key, paths: p.paths };
        else if (p.kind === 'frameScores') previews.frameScores = { key: l.key, items: p.items };
        else if (p.kind === 'pointcloud') previews.pointcloud = { key: l.key, path: p.path, points: p.points, v };
        else if (p.kind === 'cameras') previews.cameras = { key: l.key, cameras: p.cameras, v };
        else if (p.kind === 'splat') previews.splat = { key: l.key, path: p.path, step: p.step, v };
      }
      return { previews };
    });
  },
  selectStep: (selectedKey) => set({ selectedKey }),
  async cancel() {
    set({ stopping: true });
    await api().pipeline.cancel();
  },
  clearLogs: () => set({ logs: [] }),
}));

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

/** Effective status for a step: live runtime if it matches the plan, else plan/idle. */
export function stepStatus(
  s: Pick<PipelineState, 'steps' | 'plan'>,
  key: string,
  enabled: boolean,
): { status: StepStatus; rt?: StepRuntime; stats?: Record<string, number | string>; error?: string } {
  if (!enabled) return { status: 'disabled' };
  const rt = s.steps[key];
  const plan = s.plan.find((p) => p.key === key);
  const live = rt && (rt.status === 'running' || rt.status === 'queued' || !rt.hash || !plan || rt.hash === plan.hash);
  if (rt && live) return { status: rt.status, rt, stats: rt.stats ?? (plan?.cached ? plan.stats : undefined) };
  if (plan?.cached) return { status: 'cached', rt: rt?.status === 'cached' || rt?.status === 'done' ? rt : undefined, stats: plan.stats ?? rt?.stats };
  // Not in the cache: fall back to what project.json remembers.
  const last = plan?.last;
  if (last?.status === 'complete') return { status: 'stale', stats: last.stats };
  if (last?.status === 'failed' && last.hash === plan?.hash) return { status: 'error', error: last.error };
  return { status: 'idle' };
}

const isDone = (st: StepStatus) => st === 'done' || st === 'cached';

/** The "Run step" target: the user's pick, else the first enabled step that isn't done. */
export function effectiveSelectedKey(s: Pick<PipelineState, 'steps' | 'plan' | 'spec' | 'selectedKey'>): string | undefined {
  const steps = s.spec?.steps ?? [];
  if (s.selectedKey && steps.some((x) => x.key === s.selectedKey)) return s.selectedKey;
  const enabled = steps.filter((x) => x.enabled);
  return (enabled.find((x) => !isDone(stepStatus(s, x.key, true).status)) ?? enabled[enabled.length - 1])?.key;
}

export function descriptorFor(stages: StageDescriptor[], stageId: string): StageDescriptor | undefined {
  return stages.find((d) => d.id === stageId);
}

/** Stages interchangeable with `stageId` (same inputs → same outputs). */
export function alternativesFor(stages: StageDescriptor[], stageId: string): StageDescriptor[] {
  const d = descriptorFor(stages, stageId);
  if (!d) return [];
  const sig = (x: StageDescriptor) => `${[...x.inputs].sort().join(',')}→${[...x.outputs].sort().join(',')}`;
  return stages.filter((x) => sig(x) === sig(d));
}

export function qualityStepKey(spec: PipelineSpec | null): string | undefined {
  return spec?.steps.find((s) => s.stageId.includes('quality'))?.key;
}
