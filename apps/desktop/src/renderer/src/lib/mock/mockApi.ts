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
  RunSummary,
  StageNotice,
  SystemSample,
  ToolStatus,
  UpdateState,
} from '@shared/api';
import { makeCameraRing, makeFrameImage, makePointCloudPly, makeSplatPly, rng } from './assets';
import { cannedStats, curveAt, days, fakeTrainingCurve, hashStr, HOME, makeMeta, MOCK_PICK, mockKind, RECENTS, sample, STAGES } from './fixtures';

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
  const updates = emitter<UpdateState>();
  // `?update` simulates a newer release being found and downloaded.
  let update: UpdateState = { status: 'idle', version: '0.1.2', auto: true };
  const setUpdate = (patch: Partial<UpdateState>) => {
    update = { ...update, ...patch };
    updates.emit(update);
  };
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
    updates: {
      state: () => delay(update),
      check: async () => {
        if (update.status === 'checking' || update.status === 'downloading' || update.status === 'ready') return update;
        setUpdate({ status: 'checking', error: undefined });
        await sleep(700);
        if (!params.has('update')) {
          setUpdate({ status: 'current', checkedAt: new Date().toISOString() });
          return update;
        }
        setUpdate({ status: 'downloading', available: '0.1.3', fraction: 0 });
        for (let i = 1; i <= 10; i++) {
          await sleep(250);
          setUpdate({ fraction: i / 10 });
        }
        setUpdate({ status: 'ready', checkedAt: new Date().toISOString() });
        return update;
      },
      setAuto: async (auto) => {
        setUpdate({ auto });
        return update;
      },
      install: async () => {
        setUpdate({ status: 'idle', version: update.available ?? update.version, available: undefined, fraction: undefined });
      },
      onState: (cb) => updates.on(cb),
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
