import type { PendingSource, PresetId, SourceTrim } from '@shared/api';
import { create } from 'zustand';
import { useApp } from '../../store/app';
import { usePipeline } from '../../store/pipeline';
import { sourceStep } from './settings';

/** A file in the import dialog. `path` is its id. */
export interface ImportItem extends PendingSource {
  /** Seconds; from <video> metadata or ffprobe. */
  duration?: number;
  trim?: SourceTrim;
  /** Chromium can't decode it → numeric trim only. */
  unplayable?: boolean;
}

/** Settings edited in the dialog; applied to the pipeline on confirm, discarded on cancel. */
export interface ImportDraft {
  preset: PresetId;
  /** Overrides of the step that consumes `sources` (same shape as `PipelineStep.params`). */
  params: Record<string, unknown>;
  mode: 'copy' | 'link';
}

interface ImportState {
  open: boolean;
  /** `edit` = changing the trim of one already imported source. */
  kind: 'import' | 'edit';
  /** Source id in edit mode. */
  editId?: string;
  items: ImportItem[];
  selected?: string;
  draft: ImportDraft;
  busy: boolean;

  /** Inspect `paths` (or show the picker) and open the dialog. */
  begin(paths?: string[]): Promise<void>;
  /** Re-open the dialog for an imported video. */
  edit(sourceId: string): void;
  select(path: string): void;
  remove(path: string): void;
  patchItem(path: string, patch: Partial<ImportItem>): void;
  setDraft(patch: Partial<ImportDraft>): void;
  confirm(): Promise<void>;
  cancel(): void;
}

const initialDraft = (): ImportDraft => {
  const spec = usePipeline.getState().spec;
  const step = sourceStep(usePipeline.getState().stages, spec);
  return { preset: spec?.preset ?? 'balanced', params: { ...(step?.params ?? {}) }, mode: 'copy' };
};

/** Absolute path of an imported source (copied ones are relative to the project). */
export const sourceAbsPath = (dir: string, p: string) => (/^([/\\]|[A-Za-z]:)/.test(p) ? p : `${dir}/${p}`);

const fail = (e: unknown) => useApp.getState().setError(String((e as Error)?.message ?? e));

export const useImport = create<ImportState>((set, get) => ({
  open: false,
  kind: 'import',
  items: [],
  draft: { preset: 'balanced', params: {}, mode: 'copy' },
  busy: false,

  async begin(paths) {
    const { open, kind } = get();
    if (open && kind === 'edit') return;
    try {
      const found = await window.splatcraft.sources.inspect(paths);
      if (!found.length) return;
      // A second drop while the dialog is open adds to the list.
      if (get().open) {
        const known = new Set(get().items.map((i) => i.path));
        set({ items: [...get().items, ...found.filter((f) => !known.has(f.path))] });
        return;
      }
      set({ open: true, kind: 'import', editId: undefined, items: found, selected: (found.find((i) => i.kind === 'video') ?? found[0])?.path, draft: initialDraft(), busy: false });
    } catch (e) {
      fail(e);
    }
  },

  edit(sourceId) {
    const project = useApp.getState().project;
    const s = project?.meta.sources.find((x) => x.id === sourceId);
    if (!project || !s || get().open) return;
    const path = sourceAbsPath(project.dir, s.path);
    set({
      open: true,
      kind: 'edit',
      editId: s.id,
      items: [{ path, name: s.name, kind: s.kind, size: s.size, trim: s.trim }],
      selected: path,
      draft: { ...initialDraft(), mode: s.mode },
      busy: false,
    });
  },

  select: (path) => set({ selected: path }),

  remove(path) {
    const items = get().items.filter((i) => i.path !== path);
    if (!items.length) return get().cancel();
    const selected = get().selected === path ? items[0]!.path : get().selected;
    set({ items, selected });
  },

  patchItem: (path, patch) => set({ items: get().items.map((i) => (i.path === path ? { ...i, ...patch } : i)) }),

  setDraft: (patch) => set({ draft: { ...get().draft, ...patch } }),

  async confirm() {
    const { kind, editId, items, draft } = get();
    set({ busy: true });
    try {
      await applyDraft(draft);
      const api = window.splatcraft.sources;
      const meta =
        kind === 'edit' && editId
          ? await api.update(editId, { trim: items[0]?.trim ?? null })
          : await api.add(
              items.map((i) => ({ path: i.path, trim: i.kind === 'video' ? i.trim : undefined })),
              draft.mode,
            );
      useApp.getState().setMeta(meta);
      await usePipeline.getState().refreshPlan();
      if (kind === 'import') {
        // Show what was added; processing starts only when the user runs it.
        useApp.getState().setTab('gallery', false);
        useApp.getState().setGallery('sources');
      }
      set({ open: false, busy: false, items: [] });
    } catch (e) {
      set({ busy: false });
      fail(e);
    }
  },

  cancel: () => set({ open: false, items: [], busy: false }),
}));

/** Writes preset + step params into the pipeline (only what changed). */
async function applyDraft(draft: ImportDraft) {
  const p = usePipeline.getState();
  const step = sourceStep(p.stages, p.spec);
  if (step && JSON.stringify(step.params) !== JSON.stringify(draft.params)) {
    p.updateStep(step.key, { params: draft.params });
    await p.flushSpec();
  }
  if (p.spec && p.spec.preset !== draft.preset) await usePipeline.getState().setPreset(draft.preset);
}
