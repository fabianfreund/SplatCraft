import type { SystemSample } from '@shared/api';
import { create } from 'zustand';

/** ~30 min at 1 Hz for the Monitor tab; the dock uses the last 120. */
const CAP = 1800;
export const SPARK_WINDOW = 120;

export interface RunMetricRow {
  key: string;
  step: number;
  values: Record<string, number>;
}

interface MonitorState {
  samples: SystemSample[];
  latest?: SystemSample;
  /** 'live' = the current/last run in the pipeline store. */
  selectedRun: string;
  pastMetrics: RunMetricRow[] | null;
  seed(history: SystemSample[]): void;
  push(s: SystemSample): void;
  selectRun(runId: string): Promise<void>;
}

export const useMonitor = create<MonitorState>()((set) => ({
  samples: [],
  selectedRun: 'live',
  pastMetrics: null,
  async selectRun(runId) {
    set({ selectedRun: runId, pastMetrics: null });
    if (runId === 'live') return;
    const rows = await window.splatcraft.pipeline.metrics(runId);
    set((s) => (s.selectedRun === runId ? { pastMetrics: rows } : {}));
  },
  seed: (history) => set({ samples: history.slice(-CAP), latest: history[history.length - 1] }),
  push: (s) =>
    set((st) => {
      const samples = st.samples.length >= CAP ? st.samples.slice(1 - CAP) : st.samples.slice();
      samples.push(s);
      return { samples, latest: s };
    }),
}));

/** Extracted hardware series used by the dock and Monitor tab. */
export const hw = {
  gpuUtil: (s: SystemSample) => s.gpus[0]?.utilization,
  vramPct: (s: SystemSample) => {
    const g = s.gpus[0];
    return g?.vramUsedMB !== undefined && g.vramTotalMB ? (g.vramUsedMB / g.vramTotalMB) * 100 : undefined;
  },
  vramGB: (s: SystemSample) => (s.gpus[0]?.vramUsedMB !== undefined ? s.gpus[0].vramUsedMB! / 1024 : undefined),
  gpuTemp: (s: SystemSample) => s.gpus[0]?.temperatureC,
  gpuPower: (s: SystemSample) => s.gpus[0]?.powerW,
  cpu: (s: SystemSample) => s.cpu?.utilization,
  ramPct: (s: SystemSample) => (s.memory ? (s.memory.usedMB / s.memory.totalMB) * 100 : undefined),
  ramGB: (s: SystemSample) => (s.memory ? s.memory.usedMB / 1024 : undefined),
  diskFreeGB: (s: SystemSample) => (s.disk ? s.disk.freeMB / 1024 : undefined),
};
