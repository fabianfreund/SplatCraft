import { create } from 'zustand';
import { load, save } from './persist';

export interface Layers {
  points: boolean;
  cameras: boolean;
  splat: boolean;
}

interface ViewerState {
  layers: Layers;
  /** Point-cloud size multiplier (1 = automatic). */
  pointSize: number;
  setPointSize(v: number): void;
  loading: boolean;
  /** Step of the splat currently displayed. */
  shownStep?: number;
  hasContent: boolean;
  error?: string;
  /** Registered by the mounted viewer so toolbars can drive it. */
  commands?: { resetView(): void; screenshot(): void };
  setLayer(k: keyof Layers, v: boolean): void;
  set(p: Partial<Omit<ViewerState, 'set' | 'setLayer'>>): void;
}

export const useViewer = create<ViewerState>()((set, get) => ({
  layers: load<Layers>('layers', { points: true, cameras: true, splat: true }),
  pointSize: load<number>('pointSize', 1),
  setPointSize(pointSize) {
    save('pointSize', pointSize);
    set({ pointSize });
  },
  loading: false,
  hasContent: false,
  setLayer(k, v) {
    const layers = { ...get().layers, [k]: v };
    save('layers', layers);
    set({ layers });
  },
  set: (p) => set(p),
}));
