import type { AppInfo, OpenProject, PresetId, ProjectMeta, RecentProject } from '@shared/api';
import { create } from 'zustand';
import { load, save } from './persist';
import { pushMessage } from './messages';
import { usePipeline } from './pipeline';

export type WorkspaceTab = 'gallery' | 'viewer' | 'monitor' | 'runs';
export type UiMode = 'simple' | 'advanced';

interface AppState {
  booted: boolean;
  info?: AppInfo;
  recent: RecentProject[] | null;
  project: OpenProject | null;
  tab: WorkspaceTab;
  mode: UiMode;
  newProjectOpen: boolean;
  toolsOpen: boolean;
  dockExpanded: boolean;
  /** Console filter (step key or 'all'). */
  logFilter: string;
  busy: boolean;
  error?: string;
  /** Auto-switch bookkeeping for the current run. */
  autoView: { switched: boolean; userPicked: boolean };

  boot(): Promise<void>;
  refreshRecent(): Promise<void>;
  removeRecent(dir: string): Promise<void>;
  setProject(p: OpenProject | null): void;
  setMeta(meta: ProjectMeta): void;
  openProject(dir?: string): Promise<void>;
  createProject(input: { name: string; description?: string; tags?: string[]; template?: string }, preset: PresetId): Promise<void>;
  closeProject(): Promise<void>;
  updateMeta(patch: Parameters<Window['splatcraft']['projects']['updateMeta']>[0]): Promise<void>;
  /** `user` = explicit choice (suppresses the automatic switch for this run). */
  setTab(t: WorkspaceTab, user?: boolean): void;
  resetAutoView(): void;
  /** Called when a 3D preview arrives: switch Gallery → Viewer once per run. */
  maybeAutoSwitch(): void;
  setMode(m: UiMode): void;
  setNewProjectOpen(v: boolean): void;
  setToolsOpen(v: boolean): void;
  setDockExpanded(v: boolean): void;
  setLogFilter(f: string): void;
  /** Open the console filtered to one step. */
  showLog(key: string): void;
  setError(e?: string): void;
}

const api = () => window.splatcraft;

export const useApp = create<AppState>()((set, get) => ({
  booted: false,
  recent: null,
  project: null,
  tab: (['gallery', 'viewer', 'monitor', 'runs'] as const).includes(load<WorkspaceTab>('tab', 'gallery')) ? load<WorkspaceTab>('tab', 'gallery') : 'gallery',
  autoView: { switched: false, userPicked: false },
  mode: load<UiMode>('mode', 'simple'),
  newProjectOpen: false,
  toolsOpen: false,
  dockExpanded: load('dockExpanded', false),
  busy: false,
  logFilter: 'all',

  async boot() {
    const [info, project] = await Promise.all([api().app.info(), api().projects.current()]);
    set({ info });
    get().setProject(project);
    set({ booted: true });
    void get().refreshRecent();
  },
  async refreshRecent() {
    set({ recent: await api().projects.recent() });
  },
  async removeRecent(dir) {
    await api().projects.removeRecent(dir);
    await get().refreshRecent();
  },
  setProject(p) {
    const prev = get().project;
    set({ project: p });
    if (p && p.dir !== prev?.dir) {
      set({ tab: 'gallery', autoView: { switched: false, userPicked: false } });
      void usePipeline.getState().loadForProject(p);
    }
    else if (p) usePipeline.getState().syncSpec(p.meta);
    if (!p) {
      usePipeline.getState().reset();
      void get().refreshRecent();
    }
  },
  setMeta(meta) {
    const p = get().project;
    if (p) get().setProject({ ...p, meta });
  },
  async openProject(dir) {
    try {
      set({ busy: true });
      const p = await api().projects.open(dir);
      if (p) get().setProject(p);
    } catch (e) {
      set({ error: String((e as Error).message ?? e) });
    } finally {
      set({ busy: false });
    }
  },
  async createProject(input, preset) {
    try {
      set({ busy: true });
      const p = await api().projects.create(input);
      if (!p) return;
      let meta = p.meta;
      if (meta.pipeline.preset !== preset) meta = await api().pipeline.setPreset(preset);
      set({ newProjectOpen: false });
      get().setProject({ ...p, meta });
    } catch (e) {
      set({ error: String((e as Error).message ?? e) });
    } finally {
      set({ busy: false });
    }
  },
  async closeProject() {
    await api().projects.close();
    get().setProject(null);
  },
  async updateMeta(patch) {
    const meta = await api().projects.updateMeta(patch);
    get().setMeta(meta);
  },
  setTab(tab, user = true) {
    save('tab', tab);
    set((s) => ({ tab, autoView: user && usePipeline.getState().running ? { ...s.autoView, userPicked: true } : s.autoView }));
  },
  resetAutoView: () => set({ autoView: { switched: false, userPicked: false } }),
  maybeAutoSwitch() {
    const { autoView, tab } = get();
    if (autoView.switched || autoView.userPicked) return;
    set({ autoView: { ...autoView, switched: true }, ...(tab === 'gallery' ? { tab: 'viewer' as const } : {}) });
  },
  setMode(mode) {
    save('mode', mode);
    set({ mode });
  },
  setNewProjectOpen: (newProjectOpen) => set({ newProjectOpen }),
  setToolsOpen: (toolsOpen) => set({ toolsOpen }),
  setDockExpanded(dockExpanded) {
    save('dockExpanded', dockExpanded);
    set({ dockExpanded });
  },
  setLogFilter: (logFilter) => set({ logFilter }),
  showLog(key) {
    get().setDockExpanded(true);
    set({ logFilter: key });
  },
  setError(error) {
    set({ error });
    if (error) pushMessage({ level: 'error', title: error });
  },
}));
