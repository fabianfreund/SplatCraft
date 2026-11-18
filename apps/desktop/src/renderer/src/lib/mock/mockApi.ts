/**
 * Browser-only stand-in for `window.splatcraft`, loaded lazily when the
 * preload bridge is absent (plain `vite` preview, screenshots). Simulates a
 * full run: frames → quality → SfM → training with live splats → export,
 * plus ~1 Hz system samples.
 *
 * URL flags: ?mock=workspace  open a project on start
 *            &run=1            auto-start processing
 *            &speed=4          simulation speed multiplier
 *            &tab=monitor      initial workspace tab
 *            &mode=advanced    initial UI mode
 *            &dock=1           expanded status dock
 *            &layers=splat     visible viewer layers (points,cameras,splat)
 */
import type {
  AppInfo,
  SplatCraftAPI,
  EngineEvent,
  LatestPreview,
  NoticeEntry,
  MenuAction,
  OpenProject,
  PipelineSpec,
  PlanStep,
  PluginInfo,
  PresetId,
  ProjectMeta,
  RecentProject,
  RunSummary,
  StageDescriptor,
  StageNotice,
  SystemSample,
  ToolStatus,
} from '@shared/api';
import { makeCameraRing, makeFrameImage, makePointCloudPly, makeSplatPly, rng } from './assets';

type Listener<T> = (v: T) => void;

function emitter<T>() {
  const ls = new Set<Listener<T>>();
  return {
    on(cb: Listener<T>) {
      ls.add(cb);
      return () => void ls.delete(cb);
    },
    emit(v: T) {
      ls.forEach((l) => l(v));
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const delay = <T>(v: T, ms = 60) => sleep(ms).then(() => v);

/* ------------------------------------------------------------------ */
/* Static fixtures                                                     */
/* ------------------------------------------------------------------ */

const num = (o: Record<string, unknown>) => ({ type: 'number', ...o });
const int = (o: Record<string, unknown>) => ({ type: 'integer', ...o });
const bool = (o: Record<string, unknown>) => ({ type: 'boolean', ...o });
const en = (values: string[], o: Record<string, unknown>) => ({ type: 'string', enum: values, ...o });
const obj = (properties: Record<string, unknown>) => ({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties, additionalProperties: false });

const STAGES: StageDescriptor[] = [
  {
    id: 'splatcraft.prepare.frames',
    version: '1.0.0',
    title: 'Extract frames',
    description: 'Decodes videos into stills and normalises photos (orientation, colour space, max resolution).',
    category: 'prepare',
    pluginId: 'splatcraft.builtin',
    tools: ['ffmpeg'],
    inputs: ['sources'],
    outputs: ['frames'],
    resumable: false,
    paramsJsonSchema: obj({
      fps: num({ minimum: 0.25, maximum: 10, default: 2, description: 'Frames per second sampled from videos.' }),
      maxFrames: int({ minimum: 20, maximum: 2000, default: 300, description: 'Upper bound on extracted frames across all sources.' }),
      maxResolution: int({ minimum: 512, maximum: 4096, default: 1600, description: 'Longest image side in pixels.' }),
      format: en(['jpg', 'png'], { default: 'jpg', description: 'Image format of extracted frames.' }),
    }),
    presets: { fast: { fps: 1, maxFrames: 120, maxResolution: 1080 }, balanced: {}, quality: { fps: 3, maxFrames: 600, maxResolution: 2400, format: 'png' } },
  },
  {
    id: 'splatcraft.filter.quality',
    version: '1.0.0',
    title: 'Quality filter',
    description: 'Scores sharpness and exposure and drops blurry, badly exposed or duplicate frames.',
    category: 'filter',
    pluginId: 'splatcraft.builtin',
    tools: [],
    inputs: ['frames'],
    outputs: ['frames'],
    resumable: false,
    paramsJsonSchema: obj({
      sharpnessThreshold: num({ minimum: 0, maximum: 1, default: 0.35, description: 'Frames with a normalised Laplacian variance below this are rejected.' }),
      dedupe: bool({ default: true, description: 'Remove near-identical consecutive frames.' }),
      exposureCheck: bool({ default: true, description: 'Reject heavily over- or under-exposed frames.' }),
      excluded: { type: 'array', items: { type: 'string' }, default: [], description: 'Frames manually excluded.' },
      included: { type: 'array', items: { type: 'string' }, default: [], description: 'Frames manually kept.' },
    }),
    presets: { fast: { sharpnessThreshold: 0.45 }, quality: { sharpnessThreshold: 0.25 } },
  },
  {
    id: 'splatcraft.align.colmap',
    version: '1.0.0',
    title: 'Align cameras',
    description: 'Structure-from-Motion with COLMAP (GLOMAP global mapper) to recover camera poses and a sparse point cloud.',
    category: 'align',
    pluginId: 'splatcraft.builtin',
    tools: ['colmap'],
    inputs: ['frames'],
    outputs: ['dataset'],
    resumable: false,
    paramsJsonSchema: obj({
      matcher: en(['sequential', 'exhaustive', 'vocab_tree'], { default: 'sequential', description: 'Feature matching strategy. Sequential suits video, exhaustive suits small photo sets.' }),
      mapper: en(['global', 'incremental'], { default: 'global', description: 'Global (GLOMAP) is much faster; incremental can be more robust.' }),
      maxFeatures: int({ minimum: 1024, maximum: 32768, default: 8192, description: 'SIFT features per image.' }),
      useGpu: bool({ default: true, description: 'Use the GPU for feature extraction and matching.' }),
    }),
    presets: { fast: { maxFeatures: 4096 }, quality: { matcher: 'exhaustive', maxFeatures: 16384 } },
  },
  {
    id: 'splatcraft.train.brush',
    version: '1.0.0',
    title: 'Train splat',
    description: 'Trains a 3D Gaussian Splat with Brush (WebGPU — Metal, Vulkan, DX12).',
    category: 'train',
    pluginId: 'splatcraft.builtin',
    tools: ['brush'],
    inputs: ['dataset'],
    outputs: ['splat'],
    resumable: true,
    paramsJsonSchema: obj({
      steps: int({ minimum: 1000, maximum: 100000, default: 15000, description: 'Total optimisation steps.' }),
      maxSplats: int({ minimum: 100000, maximum: 10000000, default: 3000000, description: 'Upper bound on the number of gaussians.' }),
      shDegree: int({ minimum: 0, maximum: 3, default: 3, description: 'Spherical-harmonics degree for view-dependent colour.' }),
      lrScale: num({ minimum: 0.1, maximum: 4, default: 1, description: 'Global learning-rate multiplier.' }),
      previewEvery: int({ minimum: 100, maximum: 5000, default: 500, description: 'Write a live preview snapshot every N steps.' }),
      evalHoldout: bool({ default: true, description: 'Hold out every 8th view to report PSNR.' }),
    }),
    presets: { fast: { steps: 7000, maxSplats: 1000000, shDegree: 1 }, quality: { steps: 30000, maxSplats: 6000000 } },
  },
  {
    id: 'spirula.train',
    version: '0.4.0',
    title: 'Train splat (Spirula)',
    description: 'Spirula trainer with MCMC densification. Requires the Spirula add-on.',
    category: 'train',
    pluginId: 'spirula',
    tools: ['spirula'],
    inputs: ['dataset'],
    outputs: ['splat'],
    resumable: true,
    paramsJsonSchema: obj({
      steps: int({ minimum: 1000, maximum: 100000, default: 20000, description: 'Total optimisation steps.' }),
      capMax: int({ minimum: 100000, maximum: 10000000, default: 2000000, description: 'MCMC gaussian cap.' }),
      antialias: bool({ default: true, description: 'Mip-splatting style anti-aliasing.' }),
    }),
    presets: {},
  },
  {
    id: 'splatcraft.export.splat',
    version: '1.0.0',
    title: 'Edit & Export',
    description: 'Levels and scales the splat, then writes it in the chosen format(s).',
    category: 'export',
    pluginId: 'splatcraft.builtin',
    tools: [],
    inputs: ['splat'],
    outputs: ['export'],
    resumable: false,
    paramsJsonSchema: obj({
      format: en(['ply', 'spz', 'sog'], { default: 'spz', description: 'SPZ is ~10× smaller than PLY with minimal quality loss.' }),
      pruneOpacity: num({ minimum: 0, maximum: 0.5, default: 0.02, description: 'Drop gaussians below this opacity.' }),
      crop: bool({ default: false, description: 'Apply the crop box from the viewer.' }),
      alignment: { type: 'object', description: 'Ground plane and scale reference picked in the viewer.' },
    }),
    presets: {},
  },
];

const DEFAULT_SPEC: PipelineSpec = {
  preset: 'balanced',
  steps: [
    { key: 'frames', stageId: 'splatcraft.prepare.frames', enabled: true, params: {} },
    { key: 'quality', stageId: 'splatcraft.filter.quality', enabled: true, params: {} },
    { key: 'align', stageId: 'splatcraft.align.colmap', enabled: true, params: {} },
    { key: 'train', stageId: 'splatcraft.train.brush', enabled: true, params: {} },
    { key: 'export', stageId: 'splatcraft.export.splat', enabled: true, params: {} },
  ],
};

const HOME = '/Users/demo';
const days = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

const RECENTS: RecentProject[] = [
  { dir: `${HOME}/Scans/Ceramic Vase.splatcraft`, name: 'Ceramic Vase', openedAt: days(0.1), exists: true },
  { dir: `${HOME}/Scans/Courtyard Fountain.splatcraft`, name: 'Courtyard Fountain', openedAt: days(1.2), exists: true },
  { dir: `${HOME}/Projects/Client/Lobby Walkthrough.splatcraft`, name: 'Lobby Walkthrough', openedAt: days(3), exists: true },
  { dir: '/Volumes/Archive/Old Bike.splatcraft', name: 'Old Bike', openedAt: days(9), exists: false },
  { dir: `${HOME}/Scans/Garden Bench.splatcraft`, name: 'Garden Bench', openedAt: days(21), exists: true },
];

function makeMeta(name: string, dir: string, withSources: boolean): ProjectMeta {
  const sources: ProjectMeta['sources'] = [];
  if (withSources) {
    sources.push({ id: 's1', path: 'sources/IMG_4021.MOV', mode: 'copy', kind: 'video', name: 'IMG_4021.MOV', size: 412_000_000, mtimeMs: Date.now(), addedAt: days(0.2) });
    sources.push({ id: 's2', path: 'sources/IMG_4022.MOV', mode: 'copy', kind: 'video', name: 'IMG_4022.MOV', size: 188_000_000, mtimeMs: Date.now(), addedAt: days(0.2) });
    for (let i = 0; i < 6; i++) {
      const n = `DSC0${1180 + i}.JPG`;
      sources.push({ id: `p${i}`, path: `sources/${n}`, mode: 'copy', kind: 'image', name: n, size: 8_400_000 + i * 120_000, mtimeMs: Date.now(), addedAt: days(0.2) });
    }
  }
  return {
    schemaVersion: 1,
    id: Math.random().toString(36).slice(2),
    name,
    description: withSources ? 'Glazed vase on a stone plinth, turntable + handheld orbit.' : '',
    tags: withSources ? ['object', 'turntable'] : [],
    createdAt: days(2),
    updatedAt: days(0.1),
    capture: withSources ? { date: '2026-11-14', location: 'Studio B', device: 'iPhone 17 Pro', notes: '' } : {},
    sources,
    pipeline: structuredClone(DEFAULT_SPEC),
  };
}

/* ------------------------------------------------------------------ */
/* Mock implementation                                                 */
/* ------------------------------------------------------------------ */

export function createMockApi(): SplatCraftAPI {
  const params = new URLSearchParams(location.search);
  const speed = Math.max(0.25, Number(params.get('speed') ?? 1));
  const engine = emitter<EngineEvent>();
  const samples = emitter<SystemSample>();
  const menu = emitter<MenuAction>();
  const projChanged = emitter<OpenProject | null>();
  const install = emitter<{ id: string; fraction: number; message: string }>();
  const files = new Map<string, string>();

  let recents = structuredClone(RECENTS);
  let project: OpenProject | null = null;
  let running: { runId: string; abort: boolean } | null = null;
  let lastEvents: EngineEvent[] = [];
  const doneHashes = new Map<string, string>();
  const runs: RunSummary[] = [
    { runId: '2026-11-17T09-12-40-221Z_a3f1', startedAt: days(1), status: 'completed' },
    { runId: '2026-11-17T08-40-02-010Z_77c2', startedAt: days(1.05), status: 'cancelled' },
  ];
  const runMetrics = new Map<string, { key: string; step: number; values: Record<string, number> }[]>();
  for (const r of runs) runMetrics.set(r.runId, fakeTrainingCurve(r.status === 'completed' ? 15000 : 5200, r.runId.length));

  let trainingLoad = 0;
  const history: SystemSample[] = [];
  let t0 = Date.now() - 180_000;
  for (let i = 0; i < 180; i++) history.push(sample(t0 + i * 1000, 0));
  setInterval(() => {
    const s = sample(Date.now(), trainingLoad);
    history.push(s);
    if (history.length > 1800) history.shift();
    samples.emit(s);
  }, 1000);

  const tools: ToolStatus[] = [
    { id: 'ffmpeg', name: 'FFmpeg', available: true, path: '/opt/homebrew/bin/ffmpeg', version: '7.1.1', source: 'path', installable: true },
    { id: 'colmap', name: 'COLMAP', available: true, path: '~/Library/Application Support/SplatCraft/tools/colmap/bin/colmap', version: '4.0.2', source: 'managed', installable: true },
    { id: 'brush', name: 'Brush', available: true, path: 'SplatCraft.app/Contents/Resources/tools/brush', version: '0.3.0', source: 'bundled', installable: true },
    { id: 'spirula', name: 'Spirula', available: false, installable: true, installHint: 'Downloads ~180 MB' },
    { id: 'sam2', name: 'SAM 2 (AI pack)', available: false, installable: false, installHint: 'Requires uv + Python env', error: 'Not available on this platform yet' },
  ];
  const plugins: PluginInfo[] = [
    { id: 'splatcraft.builtin', name: 'SplatCraft Core', version: '0.1.0', description: 'Built-in stages, tools and monitors', stages: STAGES.filter((s) => s.pluginId === 'splatcraft.builtin').map((s) => s.id), tools: ['ffmpeg', 'colmap', 'brush'], monitors: ['sysmon.nvidia', 'sysmon.os'], pipelines: ['default', 'photos-only'] },
    { id: 'spirula', name: 'Spirula Engine', version: '0.4.0', description: 'Alternative trainer', stages: ['spirula.train'], tools: ['spirula'], monitors: [], pipelines: [] },
  ];

  const stepStats = new Map<string, Record<string, number | string>>();
  const latest = new Map<string, LatestPreview>();
  /** Notices of cached steps (manifest) and of the latest run (notices.jsonl). */
  const stepNotices = new Map<string, StageNotice[]>();
  let runNotices: NoticeEntry[] = [];
  const failAt = params.get('fail');

  function emit(e: EngineEvent) {
    if (e.type === 'run.start') runNotices = [];
    if (e.type === 'stage.start') stepNotices.delete(e.key);
    if (e.type === 'stage.notice') {
      runNotices.push({ key: e.key, stageId: e.stageId, at: e.at, notice: e.notice });
      stepNotices.set(e.key, [...(stepNotices.get(e.key) ?? []), e.notice]);
    }
    if (e.type === 'stage.preview' && e.preview.kind !== 'images') latest.set(e.preview.kind, { key: e.key, stageId: '', preview: e.preview });
    if (e.type === 'stage.done' && e.stats) stepStats.set(e.key, e.stats);
    lastEvents.push(e);
    if (lastEvents.length > 400) lastEvents = lastEvents.filter((x) => x.type !== 'stage.log' && x.type !== 'stage.metric').slice(-300);
    engine.emit(e);
  }

  function stageOf(id: string) {
    return STAGES.find((s) => s.id === id)!;
  }

  function hashChain(spec: PipelineSpec): PlanStep[] {
    let prev = 'src' + JSON.stringify((project?.meta.sources ?? []).map((x) => [x.id, x.trim ?? null]));
    return spec.steps
      .filter((s) => s.enabled)
      .map((s) => {
        const hash = hashStr(prev + s.stageId + JSON.stringify(s.params) + JSON.stringify(stageOf(s.stageId).presets[spec.preset] ?? {}));
        prev = hash;
        const cached = doneHashes.get(s.key) === hash;
        return { key: s.key, stageId: s.stageId, hash, cached, stats: cached ? stepStats.get(s.key) : undefined, notices: cached ? stepNotices.get(s.key) : undefined };
      });
  }

  function setProject(p: OpenProject | null) {
    project = p;
    lastEvents = [];
    doneHashes.clear();
    stepStats.clear();
    latest.clear();
  }

  async function simulate(runId: string, opts: { untilKey?: string; force?: string[] }) {
    const spec = project!.meta.pipeline;
    const plan = hashChain(spec);
    const until = opts.untilKey ? plan.findIndex((p) => p.key === opts.untilKey) : plan.length - 1;
    const steps = plan.slice(0, until + 1);
    emit({ type: 'run.start', runId, steps: steps.map((s) => ({ key: s.key, stageId: s.stageId, title: stageOf(s.stageId).title })) });
    let forced = false;
    const r = rng(42);
    const tick = (ms: number) => sleep(ms / speed);
    const nFrames = 72;
    try {
      for (const st of steps) {
        if (running?.abort) throw new Error('cancel');
        forced ||= !!opts.force?.includes(st.key);
        const def = stageOf(st.stageId);
        if (st.cached && !forced) {
          emit({ type: 'stage.cached', runId, key: st.key, stageId: st.stageId, hash: st.hash, stats: stepStats.get(st.key) ?? cannedStats(st.key), notices: stepNotices.get(st.key) });
          await tick(120);
          continue;
        }
        const started = Date.now();
        let stats = cannedStats(st.key);
        emit({ type: 'stage.start', runId, key: st.key, stageId: st.stageId, hash: st.hash, resume: false });
        const log = (line: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info') => emit({ type: 'stage.log', runId, key: st.key, level, line });
        const notice = (n: StageNotice) => emit({ type: 'stage.notice', runId, key: st.key, stageId: st.stageId, at: new Date().toISOString(), notice: n });
        const progress = (fraction: number, message?: string) => emit({ type: 'stage.progress', runId, key: st.key, fraction, message });
        const cat = def.category;
        if (cat === 'prepare') {
          log(`ffmpeg -i IMG_4021.MOV -vf fps=2,scale=1600:-2 -q:v 2 frames/%04d.jpg`, 'debug');
          for (let i = 0; i < nFrames; i++) {
            if (running?.abort) throw new Error('cancel');
            const path = `/mock/frames/frame_${String(i + 1).padStart(4, '0')}.jpg`;
            if (!files.has(path)) {
              const blurry = [5, 6, 19, 33, 34, 58].includes(i);
              const exp = i === 47 ? 0.55 : i === 63 ? -0.6 : 0;
              files.set(path, makeFrameImage(i, nFrames, { blur: blurry ? 3.2 : 0, exposure: exp }));
            }
            emit({ type: 'stage.preview', runId, key: st.key, preview: { kind: 'images', paths: [path], append: i > 0 } });
            if (i % 8 === 0) log(`frame=${i + 1} fps=48 q=2.0 size=${(i + 1) * 410}kB speed=3.1x`);
            progress((i + 1) / nFrames, `${i + 1} / ${nFrames} frames`);
            await tick(35);
          }
        } else if (cat === 'filter') {
          const p = spec.steps.find((s) => s.key === st.key)!.params;
          const excluded = new Set((p.excluded as string[]) ?? []);
          const included = new Set((p.included as string[]) ?? []);
          const items = Array.from({ length: nFrames }, (_, i) => {
            const name = `frame_${String(i + 1).padStart(4, '0')}.jpg`;
            const blurry = [5, 6, 19, 33, 34, 58].includes(i);
            const reason = blurry ? 'blurry' : i === 47 ? 'overexposed' : i === 63 ? 'underexposed' : i === 12 || i === 13 ? 'duplicate' : undefined;
            const score = blurry ? 0.12 + r() * 0.15 : reason ? 0.4 + r() * 0.2 : 0.55 + r() * 0.43;
            let kept = !reason;
            if (excluded.has(name)) kept = false;
            if (included.has(name)) kept = true;
            return { path: `/mock/frames/${name}`, score, kept, reason: kept ? undefined : (reason ?? 'excluded') };
          });
          for (let i = 0; i <= 10; i++) {
            progress(i / 10, 'Scoring sharpness');
            await tick(90);
          }
          emit({ type: 'stage.preview', runId, key: st.key, preview: { kind: 'frameScores', items } });
          const keptN = items.filter((x) => x.kept).length;
          stats = { frames: items.length, kept: keptN, rejected: items.length - keptN };
          log(`kept ${items.filter((x) => x.kept).length}/${items.length} frames (6 blurry, 2 exposure, 2 duplicates)`);
        } else if (cat === 'align') {
          notice({ level: 'info', title: '2 cameras detected', detail: '2160×3840 (61 images) · 750×1000 (1 image)', code: 'colmap.multiCamera' });
          if (failAt === 'align') {
            for (let i = 0; i <= 8; i++) {
              progress(i / 40, 'Extracting features');
              await tick(110);
            }
            log('colmap mapper: no good initial image pair found', 'error');
            const title = 'Only 2 usable frames: alignment needs at least 3';
            notice({
              level: 'error',
              title,
              detail: 'COLMAP registered 2 of 62 images. The rest share too few feature matches with them.',
              hint: 'Capture more overlap between neighbouring photos (60–80 %), or lower the quality filter so more frames are kept.',
              code: 'colmap.tooFewImages',
            });
            emit({ type: 'stage.error', runId, key: st.key, stageId: st.stageId, error: 'colmap exited with code 1' });
            emit({ type: 'run.done', runId, status: 'failed', error: title });
            finishRun(runId, 'failed');
            return;
          }
          const phases = ['Extracting features', 'Matching', 'Global positioning', 'Bundle adjustment'];
          if (!files.has('/mock/sparse/points.ply')) {
            files.set('/mock/sparse/points_a.ply', URL.createObjectURL(makePointCloudPly(1800, 3)));
            files.set('/mock/sparse/points_b.ply', URL.createObjectURL(makePointCloudPly(5200, 5)));
            files.set('/mock/sparse/points.ply', URL.createObjectURL(makePointCloudPly(12000, 9)));
          }
          const cams = makeCameraRing(64);
          for (let i = 0; i <= 40; i++) {
            if (running?.abort) throw new Error('cancel');
            const ph = phases[Math.min(3, Math.floor(i / 10.5))];
            progress(i / 40, ph);
            if (i % 5 === 0) log(`[${ph.toLowerCase()}] ${ph === 'Matching' ? `pairs ${i * 120}/${4800}` : `iteration ${i}`}`);
            if (i === 22) {
              emit({ type: 'stage.preview', runId, key: st.key, preview: { kind: 'cameras', cameras: cams.slice(0, 40) } });
              emit({ type: 'stage.preview', runId, key: st.key, preview: { kind: 'pointcloud', path: '/mock/sparse/points_a.ply', points: 1800 } });
            }
            if (i === 32) emit({ type: 'stage.preview', runId, key: st.key, preview: { kind: 'pointcloud', path: '/mock/sparse/points_b.ply', points: 5200 } });
            if (i === 40) {
              emit({ type: 'stage.preview', runId, key: st.key, preview: { kind: 'cameras', cameras: cams } });
              emit({ type: 'stage.preview', runId, key: st.key, preview: { kind: 'pointcloud', path: '/mock/sparse/points.ply', points: 12000 } });
            }
            if (i === 30) {
              log('2 images could not be registered: frame_0047.jpg, frame_0064.jpg', 'warn');
              notice({ level: 'warning', title: 'Only 60 of 62 cameras aligned', detail: 'frame_0047.jpg and frame_0064.jpg could not be registered.', hint: 'Usually harmless. If parts of the scene are missing, add photos of that area.' });
            }
            await tick(110);
          }
        } else if (cat === 'train') {
          const total = spec.preset === 'fast' ? 7000 : spec.preset === 'quality' ? 30000 : 15000;
          const every = 100;
          trainingLoad = 1;
          for (let s = every; s <= total; s += every) {
            if (running?.abort) throw new Error('cancel');
            const f = s / total;
            const m = curveAt(s, total, r);
            emit({ type: 'stage.metric', runId, key: st.key, step: s, values: m });
            progress(f, `step ${s.toLocaleString('en-US')} / ${total.toLocaleString('en-US')}`);
            if (s % 1000 === 0) {
              log(`step ${s}  loss ${m.loss.toFixed(4)}  psnr ${m.psnr.toFixed(2)}  splats ${Math.round(m.splats).toLocaleString('en-US')}  ${m.stepsPerSec.toFixed(1)} it/s`);
              const path = `/mock/live/splat_${s}.ply`;
              const n = Math.round(4000 + 26000 * Math.pow(f, 0.7));
              files.set(path, URL.createObjectURL(makeSplatPly(n, Math.min(1, f * 1.1), 7)));
              emit({ type: 'stage.preview', runId, key: st.key, preview: { kind: 'splat', path, step: s } });
            }
            if (s === 7000) log('densification stopped (max splats reached)', 'warn');
            await tick(total > 20000 ? 18 : 32);
          }
          trainingLoad = 0;
        } else {
          for (let i = 0; i <= 10; i++) {
            progress(i / 10, 'Writing scene.spz');
            await tick(80);
          }
          log('wrote exports/scene.spz (41.2 MB)');
        }
        doneHashes.set(st.key, st.hash);
        emit({ type: 'stage.done', runId, key: st.key, stageId: st.stageId, durationMs: Date.now() - started, stats });
      }
      emit({ type: 'run.done', runId, status: 'completed' });
      finishRun(runId, 'completed');
    } catch {
      trainingLoad = 0;
      emit({ type: 'run.done', runId, status: 'cancelled' });
      finishRun(runId, 'cancelled');
    }
  }

  function finishRun(runId: string, status: RunSummary['status']) {
    const r = runs.find((x) => x.runId === runId);
    if (r) r.status = status;
    runMetrics.set(
      runId,
      lastEvents.filter((e): e is Extract<EngineEvent, { type: 'stage.metric' }> => e.type === 'stage.metric' && e.runId === runId).map((e) => ({ key: e.key, step: e.step, values: e.values })),
    );
    running = null;
  }

  const api: SplatCraftAPI = {
    app: {
      info: () => delay<AppInfo>({ version: '0.1.2', platform: 'darwin', arch: 'arm64', electron: '45.3.3' }),
      fileUrl: (p) => {
        const hit = files.get(p);
        if (hit) return hit;
        if (/\.(jpe?g|png|heic)$/i.test(p)) {
          const url = makeFrameImage(parseInt(hashStr(p).slice(0, 4), 16) % 72, 72);
          files.set(p, url);
          return url;
        }
        return p;
      },
      revealInFolder: async () => {},
      onMenuAction: (cb) => menu.on(cb),
      onFullScreen: () => () => {},
    },
    projects: {
      recent: () => delay(recents.slice()),
      removeRecent: async (dir) => {
        recents = recents.filter((r) => r.dir !== dir);
      },
      create: async (input) => {
        await sleep(200);
        const dir = `${input.parentDir ?? `${HOME}/Scans`}/${input.name}.splatcraft`;
        const meta = makeMeta(input.name, dir, false);
        meta.description = input.description ?? '';
        meta.tags = input.tags ?? [];
        setProject({ dir, meta });
        recents = [{ dir, name: input.name, openedAt: new Date().toISOString(), exists: true }, ...recents];
        return project;
      },
      open: async (dir) => {
        await sleep(150);
        const r = recents.find((x) => x.dir === dir) ?? recents[0];
        if (!r.exists) throw new Error(`Project not found: ${r.dir}`);
        setProject({ dir: r.dir, meta: makeMeta(r.name, r.dir, true) });
        r.openedAt = new Date().toISOString();
        return project;
      },
      current: () => delay(project),
      close: async () => {
        setProject(null);
      },
      updateMeta: async (patch) => {
        project!.meta = { ...project!.meta, ...patch, updatedAt: new Date().toISOString() };
        return project!.meta;
      },
      onChanged: (cb) => projChanged.on(cb),
    },
    sources: {
      inspect: async (paths) => {
        await sleep(120);
        const list = paths?.length ? paths : MOCK_PICK;
        return list.map((p) => {
          const name = p.split('/').pop()!;
          const kind = mockKind(name);
          // No real file behind the path: videos fall back to numeric trim (as for codecs Chromium can't play).
          return { path: p, name, kind, size: Math.round(3_000_000 + (parseInt(hashStr(p).slice(0, 5), 16) % 9_000_000)), ...(kind === 'video' ? { duration: 42.5 } : {}) };
        });
      },
      add: async (items, mode = 'copy') => {
        await sleep(300);
        const known = new Set(project!.meta.sources.map((s) => s.path));
        for (const it of items) {
          if (known.has(it.path)) continue;
          const name = it.path.split('/').pop()!;
          const kind = mockKind(name);
          project!.meta.sources.push({
            id: Math.random().toString(36).slice(2, 10),
            path: it.path,
            mode,
            kind,
            name,
            size: 3_000_000 + Math.random() * 9e6,
            mtimeMs: Date.now(),
            addedAt: new Date().toISOString(),
            ...(kind === 'video' && it.trim ? { trim: it.trim } : {}),
          });
        }
        return structuredClone(project!.meta);
      },
      update: async (id, patch) => {
        const s = project!.meta.sources.find((x) => x.id === id);
        if (!s) throw new Error(`Unknown source: ${id}`);
        if ('trim' in patch) {
          if (patch.trim && s.kind === 'video') s.trim = patch.trim;
          else delete s.trim;
        }
        return structuredClone(project!.meta);
      },
      remove: async (ids) => {
        project!.meta.sources = project!.meta.sources.filter((s) => !ids.includes(s.id));
        return structuredClone(project!.meta);
      },
      pathForFile: (f) => `/Users/demo/Desktop/${f.name}`,
    },
    pipeline: {
      stages: () => delay(STAGES),
      templates: () => delay([{ id: 'default', title: 'Photos & video', description: 'Frames → filter → SfM → train → export' }, { id: 'photos-only', title: 'Photos only', description: 'Skips frame extraction' }]),
      update: async (spec) => {
        project!.meta.pipeline = structuredClone(spec);
        return structuredClone(project!.meta);
      },
      setPreset: async (preset: PresetId) => {
        project!.meta.pipeline.preset = preset;
        return structuredClone(project!.meta);
      },
      plan: async () => delay(project ? hashChain(project.meta.pipeline) : []),
      run: async (opts = {}) => {
        if (running) throw new Error('A pipeline is already running');
        if (opts.untilKey && !project!.meta.pipeline.steps.some((s) => s.enabled && s.key === opts.untilKey)) throw new Error(`Unknown or disabled step: ${opts.untilKey}`);
        const runId = new Date().toISOString().replace(/[:.]/g, '-') + '_' + Math.random().toString(16).slice(2, 6);
        running = { runId, abort: false };
        lastEvents = [];
        runs.unshift({ runId, startedAt: new Date().toISOString(), status: 'running' });
        void simulate(runId, opts);
        return { runId };
      },
      cancel: async () => {
        if (running) running.abort = true;
      },
      state: () => delay({ runningRunId: running?.runId, lastEvents: lastEvents.slice() }),
      notices: async (runId?: string) => (runId === undefined || runId === runs[0]?.runId ? runNotices.slice() : []),
      latestPreviews: async () => {
        const plan = project ? hashChain(project.meta.pipeline) : [];
        return [...latest.values()].filter((l) => plan.find((p) => p.key === l.key)?.cached);
      },
      runs: () => delay(runs.slice()),
      metrics: async (runId) => runMetrics.get(runId) ?? [],
      onEvent: (cb) => engine.on(cb),
    },
    tools: {
      status: () => delay(tools.map((t) => ({ ...t })), 200),
      install: async (id) => {
        for (let i = 0; i <= 20; i++) {
          install.emit({ id, fraction: i / 20, message: i < 16 ? `Downloading ${Math.round((i / 16) * 180)} / 180 MB` : 'Verifying' });
          await sleep(120);
        }
        const t = tools.find((x) => x.id === id)!;
        Object.assign(t, { available: true, version: '0.4.0', source: 'managed', path: `~/Library/Application Support/SplatCraft/tools/${id}/${id}` });
        return { ...t };
      },
      onInstallProgress: (cb) => install.on(cb),
    },
    plugins: { list: () => delay(plugins) },
    monitor: {
      onSample: (cb) => samples.on(cb),
      history: () => delay(history.slice()),
    },
  };

  // Keyboard shortcut emulation for the native menu (⌘N / ⌘O / ⌘W).
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const map: Record<string, MenuAction> = { n: 'project.new', o: 'project.open', w: 'project.close', ',': 'app.settings' };
    const a = map[e.key.toLowerCase()];
    if (a) {
      e.preventDefault();
      menu.emit(a);
    }
  });

  // Initial state from URL flags.
  const store = (k: string, v: string | null) => {
    if (v !== null) localStorage.setItem(`sc.${k}`, JSON.stringify(v === '1' ? true : v));
  };
  store('tab', params.get('tab'));
  store('mode', params.get('mode'));
  store('dockExpanded', params.get('dock'));
  const layers = params.get('layers');
  if (layers !== null) localStorage.setItem('sc.layers', JSON.stringify({ points: layers.includes('points'), cameras: layers.includes('cameras'), splat: layers.includes('splat') }));
  if (params.get('mock') === 'empty') {
    const dir = `${HOME}/Scans/New Scan.splatcraft`;
    recents.unshift({ dir, name: 'New Scan', openedAt: new Date().toISOString(), exists: true });
    setProject({ dir, meta: makeMeta('New Scan', dir, false) });
  }
  if (params.get('mock') === 'workspace') {
    const r = recents[0];
    setProject({ dir: r.dir, meta: makeMeta(r.name, r.dir, true) });
    if (params.get('run') === '1') setTimeout(() => void api.pipeline.run(), 400);
  }
  return api;
}

/* ------------------------------------------------------------------ */

/** What the mock file picker "selects". */
const MOCK_PICK = ['/Users/demo/Desktop/IMG_5001.MOV', '/Users/demo/Desktop/IMG_5002.JPG', '/Users/demo/Desktop/IMG_5003.JPG'];

function mockKind(name: string): 'image' | 'video' | 'other' {
  if (/\.(mov|mp4|m4v|avi|mkv|webm)$/i.test(name)) return 'video';
  return /\.(jpe?g|png|heic|tiff?|dng|webp)$/i.test(name) ? 'image' : 'other';
}

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

function cannedStats(key: string): Record<string, number | string> | undefined {
  switch (key) {
    case 'frames':
      return { frames: 72, fromPhotos: 0, fromVideos: 72, videos: 2 };
    case 'quality':
      return { frames: 72, kept: 62, rejected: 10 };
    case 'align':
      return { registered: '62/62', registeredImages: 62, totalImages: 62, points: 12000, reprojErrorPx: 0.61 };
    case 'train':
      return { steps: 15000, splats: 1_842_113, psnr: 29.4 };
    case 'export':
      return { file: 'exports/scene.spz', sizeMB: 41.2 };
  }
  return undefined;
}

function curveAt(s: number, total: number, r: () => number) {
  const f = s / total;
  const noise = (k: number) => (r() - 0.5) * k;
  return {
    loss: 0.018 + 0.16 * Math.exp(-s / 1400) + 0.012 * Math.exp(-s / 9000) + noise(0.006),
    psnr: 14 + 15.6 * (1 - Math.exp(-s / 2600)) + noise(0.5),
    splats: Math.min(1_850_000, 120_000 + 1_900_000 * Math.min(1, s / Math.min(total * 0.55, 8000))) * (1 + noise(0.004)),
    stepsPerSec: 38 - 11 * Math.min(1, f * 1.6) + noise(2.4),
  };
}

function fakeTrainingCurve(total: number, seed: number) {
  const r = rng(seed);
  const out: { key: string; step: number; values: Record<string, number> }[] = [];
  for (let s = 100; s <= total; s += 100) out.push({ key: 'train', step: s, values: curveAt(s, 15000, r) });
  return out;
}

let gpuTemp = 46;
function sample(t: number, load: number): SystemSample {
  const w = Math.sin(t / 9000) * 0.5 + 0.5;
  const util = load ? 88 + Math.random() * 10 : 3 + Math.random() * 6;
  gpuTemp += ((load ? 74 : 45) - gpuTemp) * 0.06;
  return {
    t,
    cpu: { utilization: (load ? 34 : 9) + Math.random() * 10 + w * 6, cores: 16, model: 'AMD Ryzen 9 7950X' },
    memory: { usedMB: (load ? 31_000 : 21_500) + w * 1200, totalMB: 65_536 },
    disk: { freeMB: 412_000 - (load ? 2000 : 0), totalMB: 1_907_000, path: '/Users/demo/Scans' },
    gpus: [
      {
        name: 'NVIDIA GeForce RTX 4090',
        vendor: 'nvidia',
        utilization: util,
        vramUsedMB: load ? 19_800 + w * 2100 : 1_350 + w * 200,
        vramTotalMB: 24_564,
        temperatureC: gpuTemp + Math.random(),
        powerW: load ? 380 + Math.random() * 40 : 28 + Math.random() * 6,
      },
    ],
  };
}
