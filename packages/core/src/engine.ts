import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hashOf } from './hash.js';
import type { Project } from './project.js';
import { resolveParams, type Registry } from './registry.js';
import { StageError } from './types.js';
import type {
  ArtifactKind,
  ArtifactRef,
  LogLevel,
  PipelineSpec,
  PreviewPayload,
  SpawnOptions,
  StageContext,
  StageNotice,
  StageResult,
  StepRecord,
} from './types.js';

/** Implemented by @splatcraft/toolchain; injected so core stays pure. */
export interface ToolResolver {
  /** Absolute path to the executable, or throws with an install hint. */
  resolve(toolId: string): Promise<{ path: string; version?: string }>;
}

export type EngineEvent =
  | { type: 'run.start'; runId: string; steps: { key: string; stageId: string; title: string }[] }
  | { type: 'stage.start'; runId: string; key: string; stageId: string; hash: string; resume: boolean }
  | { type: 'stage.cached'; runId: string; key: string; stageId: string; hash: string; stats?: StageResult['stats']; notices?: StageNotice[] }
  | { type: 'stage.notice'; runId: string; key: string; stageId: string; at: string; notice: StageNotice }
  | { type: 'stage.progress'; runId: string; key: string; fraction?: number; message?: string }
  | { type: 'stage.log'; runId: string; key: string; level: LogLevel; line: string }
  | { type: 'stage.metric'; runId: string; key: string; step: number; values: Record<string, number> }
  | { type: 'stage.preview'; runId: string; key: string; preview: PreviewPayload }
  | { type: 'stage.done'; runId: string; key: string; stageId: string; durationMs: number; stats?: StageResult['stats'] }
  | { type: 'stage.error'; runId: string; key: string; stageId: string; error: string }
  | { type: 'run.done'; runId: string; status: 'completed' | 'cancelled' | 'failed'; error?: string };

interface CacheManifest {
  status: 'running' | 'complete';
  stageId: string;
  stageVersion: string;
  params: Record<string, unknown>;
  inputs: Record<string, string>;
  outputs: StageResult['outputs'];
  stats?: StageResult['stats'];
  /** Notices emitted while producing this result (re-shown when cached). */
  notices?: StageNotice[];
  startedAt: string;
  finishedAt?: string;
}

export interface RunOptions {
  /** Run only up to (and including) this step key. */
  untilKey?: string;
  /** Ignore the cache for these step keys (and therefore everything downstream). */
  force?: string[];
}

/**
 * Executes a project's pipeline.
 *
 * Non-destructive + resumable by construction: each step's output lives in
 * `cache/<stage>/<hash>/` where hash = H(stage, version, params, input hashes).
 * Unchanged steps are skipped instantly; changed params only re-run downstream;
 * an interrupted resumable stage resumes in its existing work dir.
 */
export class PipelineEngine extends EventEmitter {
  private active?: { runId: string; abort: AbortController };

  constructor(
    private registry: Registry,
    private tools: ToolResolver,
  ) {
    super();
  }

  get running(): string | undefined {
    return this.active?.runId;
  }

  cancel(): void {
    this.active?.abort.abort();
  }

  private emitEvent(e: EngineEvent, runDir?: string) {
    this.emit('event', e);
    if (runDir && (e.type === 'stage.metric' || e.type === 'stage.log' || e.type === 'stage.notice')) {
      const file = e.type === 'stage.metric' ? 'metrics.jsonl' : e.type === 'stage.notice' ? 'notices.jsonl' : 'log.jsonl';
      void appendFile(path.join(runDir, file), JSON.stringify({ t: Date.now(), ...e }) + '\n').catch(() => {});
    }
  }

  /** Compute the hash chain without running (for UI "cached ✓" badges). */
  async plan(project: Project, spec: PipelineSpec = project.meta.pipeline) {
    const artifacts = this.sourcesArtifact(project);
    const steps: { key: string; stageId: string; hash: string; cached: boolean; stats?: StageResult['stats']; notices?: StageNotice[]; last?: StepRecord }[] = [];
    let available: Partial<Record<ArtifactKind, ArtifactRef>> = { sources: artifacts };
    for (const step of spec.steps.filter((s) => s.enabled)) {
      const def = this.registry.stage(step.stageId);
      const params = resolveParams(def, spec.preset, step.params);
      const inputs = pickInputs(def.inputs, available);
      const hash = hashOf(def.id, def.version, params, mapValues(inputs, (a) => a.hash), await this.toolFingerprint(def));
      const dir = path.join(project.paths.cache, sanitize(def.id), hash);
      const manifest = await readManifest(dir);
      const cached = manifest?.status === 'complete';
      const last = project.meta.steps?.[step.key];
      steps.push({
        key: step.key,
        stageId: def.id,
        hash,
        cached,
        stats: cached ? manifest?.stats : undefined,
        notices: cached ? manifest?.notices : undefined,
        ...(last ? { last } : {}),
      });
      for (const kind of def.outputs) {
        const out = manifest?.outputs?.[kind];
        available = { ...available, [kind]: { kind, path: out?.path ?? dir, hash: hashOf(hash, kind), meta: out?.meta } };
      }
    }
    return steps;
  }

  async run(project: Project, opts: RunOptions = {}): Promise<{ runId: string; status: 'completed' | 'cancelled' | 'failed' }> {
    if (this.active) throw new Error('A pipeline is already running');
    const spec = project.meta.pipeline;
    // Validate synchronously BEFORE marking the engine busy, so a bad spec can't wedge it.
    const enabled = spec.steps.filter((s) => s.enabled);
    const untilIdx = opts.untilKey ? enabled.findIndex((s) => s.key === opts.untilKey) : enabled.length - 1;
    if (untilIdx < 0) throw new Error(opts.untilKey ? `Unknown or disabled step: ${opts.untilKey}` : 'No enabled steps');
    const steps = enabled.slice(0, untilIdx + 1);
    const titles = steps.map((s) => this.registry.stage(s.stageId).title); // throws on unknown stage

    const runId = new Date().toISOString().replace(/[:.]/g, '-') + '_' + randomUUID().slice(0, 4);
    const runDir = path.join(project.paths.runs, runId);
    const abort = new AbortController();
    this.active = { runId, abort };

    let available: Partial<Record<ArtifactKind, ArtifactRef>> = { sources: this.sourcesArtifact(project) };
    let forceDownstream = false;
    /** Persists a step's outcome in project.json (best effort: never fails the run). */
    const record = (key: string, rec: Omit<StepRecord, 'runId' | 'finishedAt'> & { finishedAt?: string }) =>
      project
        .update((m) => {
          m.steps = { ...m.steps, [key]: { finishedAt: new Date().toISOString(), ...rec, runId } };
        })
        .catch(() => {});
    let status: 'completed' | 'cancelled' | 'failed' = 'completed';
    let error: string | undefined;

    try {
      await mkdir(runDir, { recursive: true });
      await writeFile(path.join(runDir, 'run.json'), JSON.stringify({ runId, startedAt: new Date().toISOString(), pipeline: spec }, null, 2));
      this.emitEvent({ type: 'run.start', runId, steps: steps.map((s, i) => ({ key: s.key, stageId: s.stageId, title: titles[i]! })) });

      for (const step of steps) {
        if (abort.signal.aborted) throw new CancelledError();
        const def = this.registry.stage(step.stageId);
        const params = resolveParams(def, spec.preset, step.params);
        const inputs = pickInputs(def.inputs, available);
        const missing = def.inputs.filter((k) => !inputs[k]);
        if (missing.length) throw new Error(`${def.title}: missing inputs ${missing.join(', ')} — enable a stage that produces them`);

        const hash = hashOf(def.id, def.version, params, mapValues(inputs, (a) => a.hash), await this.toolFingerprint(def));
        const workDir = path.join(project.paths.cache, sanitize(def.id), hash);
        forceDownstream ||= !!opts.force?.includes(step.key);
        let manifest = await readManifest(workDir);
        // A cache hit also requires the outputs to still exist on disk (user may have deleted them).
        if (
          manifest?.status === 'complete' &&
          !forceDownstream &&
          (await allExist(Object.values(manifest.outputs ?? {}).map((o) => o!.path)))
        ) {
          this.emitEvent({ type: 'stage.cached', runId, key: step.key, stageId: def.id, hash, stats: manifest.stats, notices: manifest.notices });
          // Backfill projects from before step records existed.
          const prev = project.meta.steps?.[step.key];
          if (prev?.hash !== hash || prev.status !== 'complete')
            await record(step.key, { stageId: def.id, hash, status: 'complete', stats: manifest.stats, finishedAt: manifest.finishedAt });
        } else {
          if (forceDownstream || (manifest && !def.resumable)) await rm(workDir, { recursive: true, force: true });
          const resume = !!manifest && !!def.resumable && !forceDownstream;
          await mkdir(workDir, { recursive: true });
          manifest = {
            status: 'running',
            stageId: def.id,
            stageVersion: def.version,
            params,
            inputs: mapValues(inputs, (a) => a.hash),
            outputs: {},
            startedAt: new Date().toISOString(),
          };
          await writeManifest(workDir, manifest);
          this.emitEvent({ type: 'stage.start', runId, key: step.key, stageId: def.id, hash, resume });

          const tools: Record<string, string> = {};
          for (const t of def.tools ?? []) tools[t] = (await this.tools.resolve(t)).path;
          for (const t of def.optionalTools ?? []) {
            const hit = await this.tools.resolve(t).catch(() => undefined);
            if (hit) tools[t] = hit.path;
          }

          const notices: StageNotice[] = [];
          const notify = (notice: StageNotice) => {
            notices.push(notice);
            this.emitEvent({ type: 'stage.notice', runId, key: step.key, stageId: def.id, at: new Date().toISOString(), notice }, runDir);
          };
          const ctx = this.makeContext(project, runId, runDir, step.key, workDir, params, inputs, tools, resume, abort.signal, notify);
          const t0 = Date.now();
          try {
            const result = await def.run(ctx);
            if (abort.signal.aborted) throw new CancelledError();
            manifest = {
              ...manifest,
              status: 'complete',
              outputs: result.outputs,
              stats: result.stats,
              notices: notices.length ? notices : undefined,
              finishedAt: new Date().toISOString(),
            };
            await writeManifest(workDir, manifest);
            await record(step.key, { stageId: def.id, hash, status: 'complete', durationMs: Date.now() - t0, stats: result.stats });
            this.emitEvent({ type: 'stage.done', runId, key: step.key, stageId: def.id, durationMs: Date.now() - t0, stats: result.stats });
          } catch (e) {
            if (abort.signal.aborted) throw new CancelledError();
            // Every failure becomes a readable notice; StageError carries the details.
            notify(
              e instanceof StageError
                ? { level: 'error', title: e.message, ...e.notice }
                : { level: 'error', title: `${def.title} failed`, detail: errMsg(e), hint: 'Open the log for details.' },
            );
            await record(step.key, { stageId: def.id, hash, status: 'failed', durationMs: Date.now() - t0, error: errMsg(e) });
            this.emitEvent({ type: 'stage.error', runId, key: step.key, stageId: def.id, error: errMsg(e) });
            throw e;
          }
        }

        for (const kind of def.outputs) {
          const out = manifest.outputs?.[kind];
          if (!out) continue;
          available = { ...available, [kind]: { kind, path: out.path, meta: out.meta, hash: hashOf(hash, kind) } };
        }
      }
    } catch (e) {
      if (e instanceof CancelledError || abort.signal.aborted) status = 'cancelled';
      else {
        status = 'failed';
        error = errMsg(e);
      }
    } finally {
      this.active = undefined;
      const finishedAt = new Date().toISOString();
      await project
        .update((m) => {
          m.lastRun = { runId, status, finishedAt, ...(error ? { error } : {}) };
        })
        .catch(() => {});
      await writeFile(
        path.join(runDir, 'result.json'),
        JSON.stringify({ status, error, finishedAt: new Date().toISOString(), artifacts: available }, null, 2),
      ).catch(() => {});
      this.emitEvent({ type: 'run.done', runId, status, error });
    }
    return { runId, status };
  }

  /** Tool versions are part of the cache key: upgrading COLMAP/Brush invalidates results. */
  private async toolFingerprint(def: { tools?: string[]; optionalTools?: string[] }): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const t of [...(def.tools ?? []), ...(def.optionalTools ?? [])]) {
      out[t] = await this.tools.resolve(t).then((r) => r.version ?? 'unknown', () => 'missing');
    }
    return out;
  }

  private sourcesArtifact(project: Project): ArtifactRef {
    const entries = project.meta.sources.map((s) => ({ ...s, abs: project.sourcePath(s) }));
    return {
      kind: 'sources',
      path: project.paths.sources,
      hash: hashOf('sources', entries.map((s) => [s.id, s.name, s.size, s.mtimeMs, ...(s.trim ? [s.trim.start, s.trim.end ?? null] : [])])),
      meta: { entries },
    };
  }

  private makeContext(
    project: Project,
    runId: string,
    runDir: string,
    key: string,
    workDir: string,
    params: Record<string, unknown>,
    inputs: Partial<Record<ArtifactKind, ArtifactRef>>,
    tools: Record<string, string>,
    resume: boolean,
    signal: AbortSignal,
    notice: (n: StageNotice) => void,
  ): StageContext<any> {
    const log = (line: string, level: LogLevel = 'info') => this.emitEvent({ type: 'stage.log', runId, key, level, line }, runDir);
    return {
      params,
      inputs,
      workDir,
      projectDir: project.dir,
      resume,
      signal,
      tools,
      log,
      progress: (p) => this.emitEvent({ type: 'stage.progress', runId, key, ...p }),
      metric: (step, values) => this.emitEvent({ type: 'stage.metric', runId, key, step, values }, runDir),
      preview: (preview) => this.emitEvent({ type: 'stage.preview', runId, key, preview }),
      notice,
      spawn: (tool, args, opts) => runProcess(tools[tool] ?? tool, args, opts, signal, log),
    };
  }
}

class CancelledError extends Error {
  constructor() {
    super('cancelled');
  }
}

/** Spawn a child process with line-buffered output and abort support. */
export function runProcess(
  exe: string,
  args: string[],
  opts: SpawnOptions = {},
  signal?: AbortSignal,
  log?: (line: string, level?: LogLevel) => void,
): Promise<{ code: number }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    log?.(`$ ${[exe, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`, 'debug');
    const child = spawn(exe, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const onAbort = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 3000).unref();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const wire = (stream: NodeJS.ReadableStream, name: 'stdout' | 'stderr') => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        buf += chunk;
        const parts = buf.split(/\r?\n|\r/);
        buf = parts.pop() ?? '';
        for (const line of parts) emitLine(line);
      });
      stream.on('end', () => buf && emitLine(buf));
      function emitLine(line: string) {
        if (!line.trim()) return;
        // Most CLIs (COLMAP, ffmpeg) log progress to stderr; treat it as info.
        log?.(line, 'info');
        opts.onLine?.(line, name);
      }
    };
    wire(child.stdout!, 'stdout');
    wire(child.stderr!, 'stderr');
    child.on('error', (e) => {
      signal?.removeEventListener('abort', onAbort);
      reject(e);
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(new CancelledError());
      if (code !== 0) return reject(new Error(`${path.basename(exe)} exited with code ${code}`));
      resolve({ code: code ?? 0 });
    });
  });
}

function pickInputs(kinds: ArtifactKind[], available: Partial<Record<ArtifactKind, ArtifactRef>>) {
  const out: Partial<Record<ArtifactKind, ArtifactRef>> = {};
  for (const k of kinds) if (available[k]) out[k] = available[k];
  return out;
}

function mapValues<T, U>(obj: Partial<Record<string, T>>, fn: (v: T) => U): Record<string, U> {
  const out: Record<string, U> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = fn(v as T);
  return out;
}

/** Output paths are stored relative to the work dir so projects can be moved. */
async function readManifest(dir: string): Promise<CacheManifest | undefined> {
  try {
    const m = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')) as CacheManifest;
    for (const out of Object.values(m.outputs ?? {})) if (out) out.path = path.resolve(dir, out.path);
    return m;
  } catch {
    return undefined;
  }
}

async function writeManifest(dir: string, m: CacheManifest) {
  const outputs: CacheManifest['outputs'] = {};
  for (const [k, out] of Object.entries(m.outputs ?? {})) if (out) outputs[k] = { ...out, path: path.relative(dir, out.path) || '.' };
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ ...m, outputs }, null, 2));
}

async function allExist(paths: string[]) {
  const { access } = await import('node:fs/promises');
  for (const p of paths) {
    try {
      await access(p);
    } catch {
      return false;
    }
  }
  return true;
}

function sanitize(id: string) {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
