import { existsSync } from 'node:fs';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EngineEvent, PipelineEngine, PreviewPayload, Project } from '@splatcraft/core';
// Pure text parser (no I/O); deep import because the package has no subpath exports.
import { parseImagesTxt } from '@splatcraft/plugins/src/colmap/model';
import type { LatestPreview } from '@shared/api';

/** File written next to a stage's cache manifest with its latest previews. */
const PREVIEWS_FILE = 'previews.json';
const PERSISTED = new Set<PreviewPayload['kind']>(['splat', 'pointcloud', 'cameras']);

type Stored = Partial<Record<'splat' | 'pointcloud' | 'cameras', PreviewPayload>>;

/** Same as core's (private) sanitize: cache/<stage>/<hash>. */
export function stageCacheDir(project: Project, stageId: string, hash: string) {
  return path.join(project.paths.cache, stageId.replace(/[^a-zA-Z0-9._-]/g, '_'), hash);
}

/**
 * Persists the latest splat/pointcloud/cameras preview of every running step
 * into `<cache dir>/previews.json`, so a reopened project can show results
 * without re-running (the cache dir lives and dies with the step's output).
 */
export class PreviewRecorder {
  private dirs = new Map<string, string>();
  private writes = new Map<string, Promise<void>>();

  onEvent(project: Project | undefined, e: EngineEvent) {
    if (!project) return;
    if (e.type === 'run.start') this.dirs.clear();
    if (e.type === 'stage.start') this.dirs.set(`${e.runId}:${e.key}`, stageCacheDir(project, e.stageId, e.hash));
    if (e.type !== 'stage.preview' || !PERSISTED.has(e.preview.kind)) return;
    const dir = this.dirs.get(`${e.runId}:${e.key}`);
    if (!dir) return;
    const preview = e.preview;
    const prev = this.writes.get(dir) ?? Promise.resolve();
    const next = prev.then(async () => {
      const stored = (await readJson<Stored>(path.join(dir, PREVIEWS_FILE))) ?? {};
      stored[preview.kind as keyof Stored] = relativize(dir, preview);
      const file = path.join(dir, PREVIEWS_FILE);
      await writeFile(file + '.tmp', JSON.stringify(stored));
      await rename(file + '.tmp', file);
    }).catch(() => {});
    this.writes.set(dir, next);
  }
}

export async function latestPreviews(engine: PipelineEngine, project: Project): Promise<LatestPreview[]> {
  const found = new Map<string, LatestPreview>();
  let steps: { key: string; stageId: string; dir: string }[] = [];
  try {
    steps = (await engine.plan(project))
      .filter((s) => s.cached)
      .map((s) => ({ key: s.key, stageId: s.stageId, dir: stageCacheDir(project, s.stageId, s.hash) }));
  } catch {
    /* invalid params etc. → fall back to runs */
  }
  if (!steps.length) steps = await fromNewestRun(project);
  // Later steps override earlier ones (e.g. a refine stage's splat beats train's).
  let framesDir: string | undefined; // latest upstream `frames` output, for the gallery
  for (const s of steps) {
    for (const preview of await previewsOf(s.dir)) found.set(preview.kind, { key: s.key, stageId: s.stageId, preview });
    // Gallery fallbacks: quality scores (scores.json) or the plain frame list.
    const scores = await readJson<{ frames?: { name: string; score: number; kept: boolean; reason?: string }[] }>(path.join(s.dir, 'scores.json'));
    if (scores?.frames && framesDir) {
      const dir = framesDir;
      found.set('frameScores', {
        key: s.key,
        stageId: s.stageId,
        preview: { kind: 'frameScores', items: scores.frames.map((f) => ({ path: path.join(dir, f.name), score: f.score, kept: f.kept, reason: f.reason })) },
      });
    }
    const manifest = await readJson<{ outputs?: Record<string, { path: string } | undefined> }>(path.join(s.dir, 'manifest.json'));
    const out = manifest?.outputs?.['frames'];
    if (out && !scores) {
      framesDir = path.resolve(s.dir, out.path);
      try {
        const names = (await readdir(framesDir)).filter((n) => /\.(jpe?g|png|webp|tiff?)$/i.test(n)).sort();
        if (names.length) found.set('images', { key: s.key, stageId: s.stageId, preview: { kind: 'images', paths: names.map((n) => path.join(framesDir!, n)) } });
      } catch {
        /* missing dir */
      }
    }
  }
  return [...found.values()];
}

async function previewsOf(dir: string): Promise<PreviewPayload[]> {
  const stored = (await readJson<Stored>(path.join(dir, PREVIEWS_FILE))) ?? {};
  const out: Stored = {};
  for (const [k, p] of Object.entries(stored)) if (p) out[k as keyof Stored] = absolutize(dir, p);

  // Fallbacks for caches written before previews were persisted.
  const manifest = await readJson<{ status?: string; outputs?: Record<string, { path: string; meta?: Record<string, unknown> } | undefined> }>(
    path.join(dir, 'manifest.json'),
  );
  const splat = manifest?.outputs?.['splat'];
  if (!out.splat && splat) {
    const step = Number(splat.meta?.['steps']);
    out.splat = { kind: 'splat', path: path.resolve(dir, splat.path), step: Number.isFinite(step) ? step : undefined };
  }
  if (!out.pointcloud) {
    const metaPly = manifest?.outputs?.['dataset']?.meta?.['pointsPly'];
    const ply = typeof metaPly === 'string' && existsSync(metaPly) ? metaPly : path.join(dir, 'preview', 'points.ply');
    if (existsSync(ply)) out.pointcloud = { kind: 'pointcloud', path: ply };
  }
  if (!out.cameras) {
    try {
      const cams = parseImagesTxt(await readFile(path.join(dir, 'preview', 'txt', 'images.txt'), 'utf8'));
      if (cams.length) out.cameras = { kind: 'cameras', cameras: cams };
    } catch {
      /* no COLMAP text model */
    }
  }
  return Object.values(out).filter((p): p is PreviewPayload => !!p && (p.kind !== 'splat' || existsSync(p.path)));
}

/** Steps of the newest completed run, derived from its result.json artifacts (in pipeline order). */
async function fromNewestRun(project: Project) {
  let runs: string[] = [];
  try {
    runs = (await readdir(project.paths.runs)).sort().reverse();
  } catch {
    return [];
  }
  for (const id of runs) {
    const runDir = path.join(project.paths.runs, id);
    const result = await readJson<{ status?: string; artifacts?: Record<string, { path: string } | undefined> }>(path.join(runDir, 'result.json'));
    if (result?.status !== 'completed' || !result.artifacts) continue;
    const run = await readJson<{ pipeline?: { steps?: { key: string; stageId: string }[] } }>(path.join(runDir, 'run.json'));
    const order = run?.pipeline?.steps ?? [];
    const dirs = new Map<string, string>(); // sanitized stage id → cache dir
    for (const [kind, a] of Object.entries(result.artifacts)) {
      if (!a?.path || kind === 'sources') continue;
      // Artifacts live inside cache/<stage>/<hash>/…; recover that dir.
      const rel = path.relative(project.paths.cache, a.path).split(path.sep);
      if (rel.length >= 2 && rel[0] !== '..') dirs.set(rel[0]!, path.join(project.paths.cache, rel[0]!, rel[1]!));
    }
    const steps: { key: string; stageId: string; dir: string }[] = [];
    for (const st of order) {
      const dir = dirs.get(st.stageId.replace(/[^a-zA-Z0-9._-]/g, '_'));
      if (dir) steps.push({ key: st.key, stageId: st.stageId, dir });
    }
    return steps;
  }
  return [];
}

function relativize(dir: string, p: PreviewPayload): PreviewPayload {
  if ((p.kind === 'splat' || p.kind === 'pointcloud') && path.isAbsolute(p.path) && !path.relative(dir, p.path).startsWith('..')) {
    return { ...p, path: path.relative(dir, p.path) };
  }
  return p;
}

function absolutize(dir: string, p: PreviewPayload): PreviewPayload {
  if (p.kind === 'splat' || p.kind === 'pointcloud') return { ...p, path: path.resolve(dir, p.path) };
  return p;
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}
