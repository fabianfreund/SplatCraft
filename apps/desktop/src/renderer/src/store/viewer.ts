import { create } from 'zustand';
import { load, save } from './persist';

export interface Layers {
  points: boolean;
  cameras: boolean;
  splat: boolean;
}

interface ViewerState {
  layers: Layers;
  loading: boolean;
  /** Step of the splat currently displayed. */
  shownStep?: number;
  hasContent: boolean;
  error?: string;
  setLayer(k: keyof Layers, v: boolean): void;
  set(p: Partial<Omit<ViewerState, 'set' | 'setLayer'>>): void;
}

export const useViewer = create<ViewerState>()((set, get) => ({
  layers: load<Layers>('layers', { points: true, cameras: true, splat: true }),
  loading: false,
  hasContent: false,
  setLayer(k, v) {
    const layers = { ...get().layers, [k]: v };
    save('layers', layers);
    set({ layers });
  },
  set: (p) => set(p),
}));
