/**
 * The contract between the Electron main process and the renderer.
 * The preload script exposes an object implementing `SplatCraftAPI` as
 * `window.splatcraft`. Keep this file free of Node/Electron imports.
 */
import type {
  EngineEvent,
  PipelineSpec,
  PluginInfo,
  PresetId,
  PreviewPayload,
  ProjectMeta,
  StageDescriptor,
  StageNotice,
  SystemSample,
  ToolStatus,
} from '@splatcraft/core';

export type { EngineEvent, PipelineSpec, PluginInfo, PresetId, PreviewPayload, ProjectMeta, StageDescriptor, StageNotice, SystemSample, ToolStatus };

/** A notice posted by a step during a run (persisted in runs/<id>/notices.jsonl). */
export interface NoticeEntry {
  key: string;
  stageId: string;
  at: string;
  notice: StageNotice;
}

export interface RecentProject {
  dir: string;
  name: string;
  openedAt: string;
  /** Absolute path to a thumbnail image, if any. */
  thumbnail?: string;
  exists: boolean;
}

export interface OpenProject {
  dir: string;
  meta: ProjectMeta;
}

export interface PlanStep {
  key: string;
  stageId: string;
  hash: string;
  cached: boolean;
  /** Stats of the cached result (when cached). */
  stats?: Record<string, number | string>;
  /** Notices stored with the cached result (when cached). */
  notices?: StageNotice[];
}

export interface RunSummary {
  runId: string;
  startedAt: string;
  status?: 'completed' | 'cancelled' | 'failed' | 'running';
  error?: string;
  /** From result.json; absent while running or if the app quit mid-run. */
  finishedAt?: string;
}

/** A persisted preview of a completed (cached) step, for showing results after reopening a project. */
export interface LatestPreview {
  key: string;
  stageId: string;
  preview: PreviewPayload;
}

/** Latest known state of the pipeline, for when the renderer (re)connects. */
export interface PipelineState {
  runningRunId?: string;
  lastEvents: EngineEvent[];
}

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  electron: string;
}

/** Commands sent by the native application menu. */
export type MenuAction = 'project.new' | 'project.open' | 'project.close' | 'app.settings';

export interface SplatCraftAPI {
  app: {
    info(): Promise<AppInfo>;
    /** Turns an absolute local path into a URL the renderer may load (images, .ply). */
    fileUrl(absPath: string): string;
    revealInFolder(absPath: string): Promise<void>;
    /** Application-menu commands the renderer should handle (e.g. ⌘N → show "New project" form). */
    onMenuAction(cb: (action: MenuAction) => void): () => void;
    /** Native window full screen changed (macOS hides the traffic lights). */
    onFullScreen(cb: (fullScreen: boolean) => void): () => void;
  };
  projects: {
    recent(): Promise<RecentProject[]>;
    removeRecent(dir: string): Promise<void>;
    /** Shows a folder picker for the parent dir unless given. Returns null if cancelled. */
    create(input: { name: string; description?: string; tags?: string[]; parentDir?: string; template?: string }): Promise<OpenProject | null>;
    /** Shows a picker for a `.splatcraft` folder unless given. */
    open(dir?: string): Promise<OpenProject | null>;
    current(): Promise<OpenProject | null>;
    close(): Promise<void>;
    updateMeta(patch: Partial<Pick<ProjectMeta, 'name' | 'description' | 'tags' | 'capture'>>): Promise<ProjectMeta>;
    /** Fires whenever the current project changes from the main side (menu Open/Close, argv, Finder, meta updates). */
    onChanged(cb: (p: OpenProject | null) => void): () => void;
  };
  sources: {
    /** Absolute file paths (from drag & drop via `getPathForFile`) or a picker when omitted. */
    add(paths?: string[], mode?: 'copy' | 'link'): Promise<ProjectMeta>;
    remove(ids: string[]): Promise<ProjectMeta>;
    /** Resolve a dropped File to its absolute path (Electron webUtils). */
    pathForFile(file: File): string;
  };
  pipeline: {
    stages(): Promise<StageDescriptor[]>;
    templates(): Promise<{ id: string; title: string; description: string }[]>;
    update(spec: PipelineSpec): Promise<ProjectMeta>;
    setPreset(preset: PresetId): Promise<ProjectMeta>;
    plan(): Promise<PlanStep[]>;
    run(opts?: { untilKey?: string; force?: string[] }): Promise<{ runId: string }>;
    cancel(): Promise<void>;
    state(): Promise<PipelineState>;
    runs(): Promise<RunSummary[]>;
    /** Persisted metrics of a run (for charts after restart). */
    metrics(runId: string): Promise<{ key: string; step: number; values: Record<string, number> }[]>;
    /**
     * Latest splat / pointcloud / cameras of the current pipeline's cached steps
     * (falls back to the newest completed run). At most one entry per preview kind.
     */
    latestPreviews(): Promise<LatestPreview[]>;
    /** Notices of a run (default: the latest run), e.g. why a step failed. */
    notices(runId?: string): Promise<NoticeEntry[]>;
    onEvent(cb: (e: EngineEvent) => void): () => void;
  };
  tools: {
    status(refresh?: boolean): Promise<ToolStatus[]>;
    install(id: string): Promise<ToolStatus>;
    onInstallProgress(cb: (p: { id: string; fraction: number; message: string }) => void): () => void;
  };
  plugins: {
    list(): Promise<PluginInfo[]>;
  };
  monitor: {
    /** Samples arrive ~1 Hz while subscribed. */
    onSample(cb: (s: SystemSample) => void): () => void;
    history(): Promise<SystemSample[]>;
  };
}

/** IPC channel names (main ↔ preload). */
export const IPC = {
  invoke: 'sc:invoke', // (method: string, ...args) → result
  engineEvent: 'sc:engine-event',
  monitorSample: 'sc:monitor-sample',
  installProgress: 'sc:install-progress',
  projectChanged: 'sc:project-changed',
  menuAction: 'sc:menu-action',
  fullScreen: 'sc:full-screen',
} as const;

/** Custom protocol used by `app.fileUrl` to serve local files safely. */
export const FILE_PROTOCOL = 'sc-file';
