import type { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Artifacts                                                           */
/* ------------------------------------------------------------------ */

/**
 * Well-known artifact kinds. Stages declare which kinds they consume and
 * produce; the engine wires steps together by kind, so any stage producing
 * `splat` can replace any other (e.g. Brush ↔ Spirula ↔ gsplat).
 * Plugins may introduce new kinds (use a namespaced string, e.g. `acme.mesh`).
 */
export type ArtifactKind =
  | 'sources' // raw imported media (photos, videos)
  | 'frames' // a folder of still images extracted/normalized from sources
  | 'dataset' // a training-ready folder: images/ + sparse/0 (COLMAP layout)
  | 'splat' // a trained gaussian splat (.ply)
  | 'export' // final exported files
  | (string & {});

export interface ArtifactRef {
  kind: ArtifactKind;
  /** Absolute path to a file or directory. */
  path: string;
  /** Recipe hash of the producing step (content-addressed cache key). */
  hash: string;
  /** Free-form, JSON-serialisable metadata (counts, formats …). */
  meta?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Stages                                                              */
/* ------------------------------------------------------------------ */

export type StageCategory = 'prepare' | 'filter' | 'align' | 'train' | 'refine' | 'export';
export type PresetId = 'fast' | 'balanced' | 'quality';

export interface StageDefinition<P extends Record<string, unknown> = Record<string, any>> {
  /** Globally unique, e.g. `splatcraft.train.brush`. */
  id: string;
  /** Bump when output format/behaviour changes — invalidates cache. */
  version: string;
  title: string;
  description: string;
  category: StageCategory;
  /** zod object schema. Drives validation AND the auto-generated Advanced UI. */
  paramsSchema: z.ZodType<P>;
  /** Partial overrides per preset; schema defaults are the baseline. */
  presets?: Partial<Record<PresetId, Partial<P>>>;
  /** Tool ids (see ToolSpec) the stage needs. Resolved before run. */
  tools?: string[];
  /**
   * Tool ids that are used only for some inputs (e.g. ffmpeg for videos).
   * Resolved like `tools` but missing ones are simply absent from `ctx.tools`.
   */
  optionalTools?: string[];
  inputs: ArtifactKind[];
  outputs: ArtifactKind[];
  /**
   * If true, an interrupted run keeps its work directory and the next run
   * receives `ctx.resume = true` (e.g. trainer restarts from checkpoint).
   */
  resumable?: boolean;
  run(ctx: StageContext<P>): Promise<StageResult>;
}

export interface StageResult {
  outputs: Partial<Record<ArtifactKind, Omit<ArtifactRef, 'hash' | 'kind'>>>;
  /** Shown in the statistics panel, e.g. { framesKept: 120, registered: '98%' }. */
  stats?: Record<string, number | string>;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Called for every stdout/stderr line (already logged by the engine). */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
}

export interface SpawnResult {
  code: number;
}

export interface StageContext<P> {
  params: P;
  inputs: Partial<Record<ArtifactKind, ArtifactRef>>;
  /** Stage-owned directory; outputs must live inside it. */
  workDir: string;
  /** Project root (read-only for stages). */
  projectDir: string;
  /** True when a previous interrupted run left state in workDir. */
  resume: boolean;
  signal: AbortSignal;
  /** Absolute paths of resolved tool executables, keyed by tool id. */
  tools: Record<string, string>;
  spawn(tool: string, args: string[], opts?: SpawnOptions): Promise<SpawnResult>;
  progress(p: { fraction?: number; message?: string }): void;
  log(line: string, level?: LogLevel): void;
  /** Time-series metrics (loss, psnr, gaussians …) — persisted + charted. */
  metric(step: number, values: Record<string, number>): void;
  preview(p: PreviewPayload): void;
  /**
   * A human-readable message for the user (shown in the Messages panel and on
   * the step). Use it to explain *why* something happened and what to do.
   */
  notice(n: StageNotice): void;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StageNotice {
  level: 'info' | 'warning' | 'error';
  /** Short, plain-language summary ("Only 1 of 14 images could be used"). */
  title: string;
  /** What happened, in more detail. */
  detail?: string;
  /** What the user can do about it. */
  hint?: string;
  /** Stable machine code for grouping/i18n, e.g. `colmap.mixed-cameras`. */
  code?: string;
}

/** Throw from a stage to fail with a readable explanation instead of a raw error. */
export class StageError extends Error {
  constructor(
    message: string,
    readonly notice: Omit<StageNotice, 'level' | 'title'> = {},
  ) {
    super(message);
    this.name = 'StageError';
  }
}

/* ------------------------------------------------------------------ */
/* Live preview                                                        */
/* ------------------------------------------------------------------ */

export type PreviewPayload =
  | { kind: 'images'; paths: string[]; append?: boolean }
  | {
      kind: 'frameScores';
      items: { path: string; score: number; kept: boolean; reason?: string }[];
    }
  | { kind: 'pointcloud'; path: string; points?: number }
  | {
      kind: 'cameras';
      cameras: { name: string; position: [number, number, number]; quaternion: [number, number, number, number] }[];
    }
  | { kind: 'splat'; path: string; step?: number };

/* ------------------------------------------------------------------ */
/* Pipelines & projects                                                */
/* ------------------------------------------------------------------ */

export interface PipelineStep {
  /** Stable id within the pipeline (lets two steps use the same stage). */
  key: string;
  stageId: string;
  enabled: boolean;
  /** User overrides on top of preset + defaults. */
  params: Record<string, unknown>;
}

export interface PipelineSpec {
  preset: PresetId;
  steps: PipelineStep[];
}

export interface PipelineTemplate {
  id: string;
  title: string;
  description: string;
  steps: Omit<PipelineStep, 'params'>[];
}

export type SourceKind = 'image' | 'video' | 'other';

/** Part of a video to use, in seconds from the start. `end` omitted = until the end. */
export interface SourceTrim {
  start: number;
  end?: number;
}

export interface SourceEntry {
  id: string;
  /** Relative to project dir when copied, absolute when linked. */
  path: string;
  mode: 'copy' | 'link';
  kind: SourceKind;
  name: string;
  size: number;
  mtimeMs: number;
  addedAt: string;
  /** Videos only: the range to extract frames from. */
  trim?: SourceTrim;
}

/**
 * Last known result of a pipeline step. Kept in project.json so a reopened
 * project still shows its progress, even when the cache was cleaned or the
 * settings changed since (then the step is "outdated" rather than unknown).
 */
export interface StepRecord {
  stageId: string;
  /** Cache key the result was produced with. */
  hash: string;
  status: 'complete' | 'failed';
  runId: string;
  finishedAt: string;
  durationMs?: number;
  stats?: Record<string, number | string>;
  error?: string;
}

export interface RunRecord {
  runId: string;
  status: 'completed' | 'cancelled' | 'failed';
  finishedAt: string;
  error?: string;
}

export interface ProjectMeta {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  capture: { date?: string; location?: string; device?: string; notes?: string };
  sources: SourceEntry[];
  pipeline: PipelineSpec;
  /** Last result per step key (written by the engine). */
  steps?: Record<string, StepRecord>;
  /** The most recent run. */
  lastRun?: RunRecord;
  /**
   * Per step key, how often it was force re-run. Part of the step's cache key,
   * so a forced re-run also makes every later step out of date (written by the engine).
   */
  generations?: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* Tools (external binaries)                                           */
/* ------------------------------------------------------------------ */

export type PlatformKey = 'darwin-arm64' | 'darwin-x64' | 'win32-x64' | 'linux-x64' | 'linux-arm64';

export type InstallRecipe =
  | {
      type: 'download';
      url: string;
      sha256?: string;
      archive: 'tar.xz' | 'tar.gz' | 'zip' | 'none';
      /** Path of the executable inside the extracted archive. */
      binPath: string;
    }
  | { type: 'brew'; formula: string }
  | { type: 'manual'; instructions: string; url?: string };

export interface ToolSpec {
  id: string;
  name: string;
  description: string;
  license: string;
  homepage: string;
  /** Executable names to look for on PATH, in order. */
  executables: string[];
  versionArgs?: string[];
  parseVersion?(output: string): string | undefined;
  install?: Partial<Record<PlatformKey, InstallRecipe>>;
}

export interface ToolStatus {
  id: string;
  name: string;
  available: boolean;
  path?: string;
  version?: string;
  source?: 'env' | 'managed' | 'bundled' | 'path';
  installable: boolean;
  installHint?: string;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* System monitoring                                                   */
/* ------------------------------------------------------------------ */

export interface GpuSample {
  name: string;
  vendor: 'apple' | 'nvidia' | 'amd' | 'intel' | 'unknown';
  utilization?: number; // 0..100
  vramUsedMB?: number;
  vramTotalMB?: number;
  temperatureC?: number;
  powerW?: number;
}

export interface SystemSample {
  t: number;
  cpu?: { utilization: number; cores: number; model?: string };
  memory?: { usedMB: number; totalMB: number };
  disk?: { freeMB: number; totalMB: number; path: string };
  gpus: GpuSample[];
}

export interface MonitorProvider {
  id: string;
  name: string;
  isSupported(): Promise<boolean>;
  /** Return whichever fields this provider knows; samples are merged. */
  sample(ctx: { projectDir?: string }): Promise<Partial<SystemSample>>;
}

/* ------------------------------------------------------------------ */
/* Plugins                                                             */
/* ------------------------------------------------------------------ */

export interface PluginAPI {
  registerStage<P extends Record<string, unknown>>(def: StageDefinition<P>): void;
  registerTool(spec: ToolSpec): void;
  registerMonitor(provider: MonitorProvider): void;
  registerPipeline(template: PipelineTemplate): void;
}

export interface SplatCraftPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  register(api: PluginAPI): void | Promise<void>;
}

export function definePlugin(p: SplatCraftPlugin): SplatCraftPlugin {
  return p;
}

export function defineStage<P extends Record<string, unknown>>(def: StageDefinition<P>): StageDefinition<P> {
  return def;
}
