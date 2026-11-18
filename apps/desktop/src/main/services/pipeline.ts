import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveParams, type PipelineSpec, type PresetId, type Project, type Registry } from '@splatcraft/core';
import type { NoticeEntry, RunSummary } from '@shared/api';

const PRESETS: PresetId[] = ['fast', 'balanced', 'quality'];

export function assertPreset(p: unknown): asserts p is PresetId {
  if (!PRESETS.includes(p as PresetId)) throw new Error(`Unknown preset: ${String(p)}`);
}

/** Structural + param validation of a pipeline spec coming from the renderer. */
export function validateSpec(registry: Registry, spec: PipelineSpec): PipelineSpec {
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.steps)) throw new Error('Invalid pipeline spec');
  assertPreset(spec.preset);
  const keys = new Set<string>();
  const steps = spec.steps.map((s, i) => {
    if (!s || typeof s.key !== 'string' || !s.key) throw new Error(`Step ${i + 1}: missing key`);
    if (keys.has(s.key)) throw new Error(`Duplicate step key: ${s.key}`);
    keys.add(s.key);
    if (!registry.stages.has(s.stageId)) throw new Error(`Step "${s.key}": unknown stage ${s.stageId}`);
    const params = s.params && typeof s.params === 'object' ? s.params : {};
    if (s.enabled) {
      try {
        resolveParams(registry.stage(s.stageId), spec.preset, params);
      } catch (e) {
        throw new Error(`Step "${s.key}": invalid parameters — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { key: s.key, stageId: s.stageId, enabled: !!s.enabled, params };
  });
  return { preset: spec.preset, steps };
}

const RUN_ID_RE = /^[A-Za-z0-9._-]+$/;

export function assertRunId(runId: unknown): asserts runId is string {
  if (typeof runId !== 'string' || !RUN_ID_RE.test(runId) || runId === '.' || runId === '..') throw new Error('Invalid run id');
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export async function listRuns(project: Project, runningRunId?: string): Promise<RunSummary[]> {
  let entries: string[] = [];
  try {
    entries = (await readdir(project.paths.runs, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const runs = await Promise.all(
    entries.map(async (dir): Promise<RunSummary | undefined> => {
      const run = await readJson<{ runId?: string; startedAt?: string }>(path.join(project.paths.runs, dir, 'run.json'));
      if (!run) return undefined;
      const result = await readJson<{ status?: RunSummary['status']; error?: string; finishedAt?: string }>(path.join(project.paths.runs, dir, 'result.json'));
      const runId = run.runId ?? dir;
      return {
        runId,
        startedAt: run.startedAt ?? '',
        // No result.json and not running → the app quit mid-run.
        status: runId === runningRunId ? 'running' : (result?.status ?? 'cancelled'),
        error: result?.error,
        finishedAt: result?.finishedAt,
      };
    }),
  );
  return runs.filter((r): r is RunSummary => !!r).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function readMetrics(project: Project, runId: string) {
  assertRunId(runId);
  let raw = '';
  try {
    raw = await readFile(path.join(project.paths.runs, runId, 'metrics.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const out: { key: string; step: number; values: Record<string, number> }[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (typeof e.step === 'number' && e.values) out.push({ key: String(e.key), step: e.step, values: e.values });
    } catch {
      /* partial last line while writing */
    }
  }
  return out;
}

/** Notices of a run (default: the newest run directory). */
export async function readNotices(project: Project, runId?: string): Promise<NoticeEntry[]> {
  if (runId !== undefined && runId !== null) assertRunId(runId);
  else {
    try {
      runId = (await readdir(project.paths.runs)).filter((d) => !d.startsWith('.')).sort().pop();
    } catch {
      return [];
    }
    if (!runId) return [];
  }
  let raw = '';
  try {
    raw = await readFile(path.join(project.paths.runs, runId, 'notices.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const out: NoticeEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e?.notice && typeof e.notice.title === 'string') out.push({ key: String(e.key), stageId: String(e.stageId ?? ''), at: String(e.at ?? new Date(e.t ?? 0).toISOString()), notice: e.notice });
    } catch {
      /* partial last line while writing */
    }
  }
  return out;
}
