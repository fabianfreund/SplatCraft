import type { AppInfo, OpenProject, PresetId, ProjectMeta, RecentProject } from '@shared/api';
import { create } from 'zustand';
import { load, save } from './persist';
import { pushMessage } from './messages';
import { descriptorFor, usePipeline } from './pipeline';
import { useViewer } from './viewer';
import { focusFor } from '../lib/steps';

export type WorkspaceTab = 'gallery' | 'viewer' | 'monitor' | 'runs';
export type UiMode = 'simple' | 'advanced';
export type SettingsSection = 'general' | 'appearance' | 'tools';
/** Views each mode offers. Advanced only adds; it never removes or reorders. */
export const VIEWS: Record<UiMode, WorkspaceTab[]> = { simple: ['gallery', 'viewer'], advanced: ['gallery', 'viewer', 'monitor', 'runs'] };

interface AppState {
  booted: boolean;
  info?: AppInfo;
  recent: RecentProject[] | null;
  project: OpenProject | null;
  tab: WorkspaceTab;
  mode: UiMode;
  newProjectOpen: boolean;
  /** Open settings section, or null. */
  settings: SettingsSection | null;
  /** Focus mode: rail, inspector and status bar hidden. */
  chromeHidden: boolean;
  dockExpanded: boolean;
  /** Console filter (step key or 'all'). */
  logFilter: string;
  busy: boolean;
  /** A known project is being opened (drives the app-wide loader; not set while a file picker is up). */
  opening: boolean;
  error?: string;
  /** Gallery content (set by step focus). */
  gallery: 'sources' | 'frames';
  /** The user picked a view by hand during the current run → automatic focus pauses until the next run. */
  autoView: { userPicked: boolean };

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
  /**
   * Shows what a step is about: view (gallery/viewer), gallery content and viewer layers.
   * 'user' = the user selected the step (always applies); 'auto' = a step started running
   * (skipped if the user picked a view during the step, or is on Monitor/Runs).
   */
  focusStep(key: string, origin: 'user' | 'auto'): void;
  setGallery(g: 'sources' | 'frames'): void;
  setMode(m: UiMode): void;
  setNewProjectOpen(v: boolean): void;
  setSettings(s: SettingsSection | null): void;
  /** Shortcut for Settings → Tools & Add-ons. */
  setToolsOpen(v: boolean): void;
  toggleChrome(): void;
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
  gallery: 'frames',
  autoView: { userPicked: false },
  mode: load<UiMode>('mode', 'simple'),
  newProjectOpen: false,
  settings: null,
  chromeHidden: false,
  dockExpanded: load('dockExpanded', false),
  busy: false,
  opening: false,
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
      set({ tab: 'gallery', gallery: 'frames', autoView: { userPicked: false } });
      usePipeline
        .getState()
        .loadForProject(p)
        .catch((e) => {
          // Never leave the workspace behind the "Preparing" overlay.
          usePipeline.setState({ stagesLoaded: true });
          get().setError(`Could not load the workflow: ${String((e as Error)?.message ?? e)}`);
        });
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
      set({ busy: true, opening: !!dir });
      const p = await api().projects.open(dir);
      if (p) get().setProject(p);
    } catch (e) {
      set({ error: String((e as Error).message ?? e) });
    } finally {
      set({ busy: false, opening: false });
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
    set((s) => ({ tab, autoView: user && usePipeline.getState().running ? { userPicked: true } : s.autoView }));
  },
  resetAutoView: () => set({ autoView: { userPicked: false } }),
  setGallery: (gallery) => set({ gallery }),
  focusStep(key, origin) {
    const p = usePipeline.getState();
    const st = p.spec?.steps.find((x) => x.key === key);
    if (!st) return;
    const { tab, autoView } = get();
    if (origin === 'auto' && autoView.userPicked) return;
    const f = focusFor(descriptorFor(p.stages, st.stageId)?.category);
    // Monitor / Runs are tools the user opened on purpose: update content, keep the view.
    const keepTab = tab === 'monitor' || tab === 'runs';
    if (!keepTab) save('tab', f.tab);
    set({ ...(keepTab ? {} : { tab: f.tab }), ...(f.gallery ? { gallery: f.gallery } : {}) });
    // Not persisted: the user's own layer toggles are what gets saved.
    if (f.layers) useViewer.getState().set({ layers: f.layers });
  },
  setMode(mode) {
    save('mode', mode);
    // Leaving advanced: fall back to a view simple mode has (state is kept).
    set((s) => ({ mode, tab: VIEWS[mode].includes(s.tab) ? s.tab : 'gallery' }));
  },
  setNewProjectOpen: (newProjectOpen) => set({ newProjectOpen }),
  setSettings: (settings) => set({ settings }),
  setToolsOpen: (v) => set({ settings: v ? 'tools' : null }),
  toggleChrome: () => set((s) => ({ chromeHidden: !s.chromeHidden })),
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
