import type { RunSummary, SystemSample } from '@shared/api';
import { LineChart as ChartIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatDateTime, formatNumber, humanize } from '../../lib/format';
import { hw, useMonitor } from '../../store/monitor';
import { usePipeline, type MetricPoint } from '../../store/pipeline';
import { EmptyState, Label, Select, Skeleton } from '../../ui';
import { LineChart, type Point } from '../charts/LineChart';

const METRIC_META: Record<string, { title?: string; help?: string; format?: (v: number) => string; log?: boolean; unit?: string }> = {
  loss: { title: 'Loss', help: 'Training loss (L1 + D-SSIM). Lower is better.', format: (v) => v.toFixed(4), log: true },
  psnr: { title: 'PSNR', help: 'Peak signal-to-noise ratio on held-out views. Higher is better.', format: (v) => v.toFixed(1), unit: 'dB' },
  splats: { title: 'Gaussians', help: 'Number of gaussians in the scene.', format: (v) => formatNumber(v) },
  gaussians: { title: 'Gaussians', format: (v) => formatNumber(v) },
  stepsPerSec: { title: 'Speed', format: (v) => v.toFixed(1), unit: 'it/s' },
};

export function MonitorTab() {
  const samples = useMonitor((s) => s.samples);
  const selectedRun = useMonitor((s) => s.selectedRun);
  const pastMetrics = useMonitor((s) => s.pastMetrics);
  const selectRun = useMonitor((s) => s.selectRun);
  const liveMetrics = usePipeline((s) => s.metrics);
  const runId = usePipeline((s) => s.runId);
  const running = usePipeline((s) => s.running);
  const [runs, setRuns] = useState<RunSummary[]>([]);

  useEffect(() => {
    void window.splatcraft.pipeline.runs().then(setRuns);
  }, [runId, running]);

  const metrics: Record<string, MetricPoint[]> | null = useMemo(() => {
    if (selectedRun === 'live' || selectedRun === runId) return liveMetrics;
    if (!pastMetrics) return null;
    const out: Record<string, MetricPoint[]> = {};
    for (const row of pastMetrics) for (const [k, v] of Object.entries(row.values)) (out[k] ??= []).push({ step: row.step, value: v, key: row.key });
    return out;
  }, [selectedRun, runId, liveMetrics, pastMetrics]);

  const hwSeries = useMemo(() => {
    const t1 = samples[samples.length - 1]?.t ?? Date.now();
    const mk = (f: (s: SystemSample) => number | undefined): Point[] =>
      samples.flatMap((s) => {
        const y = f(s);
        return y === undefined ? [] : [{ x: (s.t - t1) / 1000, y }];
      });
    return { gpu: mk(hw.gpuUtil), vram: mk(hw.vramGB), cpu: mk(hw.cpu), ram: mk(hw.ramGB), temp: mk(hw.gpuTemp), power: mk(hw.gpuPower) };
  }, [samples]);

  const last = samples[samples.length - 1];
  const fmtAgo = (x: number) => (Math.abs(x) < 1 ? 'now' : Math.abs(x) < 90 ? `${Math.round(x)}s` : `${Math.round(x / 60)}m`);
  const metricKeys = metrics ? Object.keys(metrics) : [];

  return (
    <div className="scroll-stable absolute inset-0 bg-bg px-5 py-4" style={{ animation: 'sc-fade-in var(--sc-duration-base) var(--sc-ease-out)' }}>
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
        <section className="flex flex-col gap-3">
          <div className="flex h-7 items-center gap-2">
            <Label>Training</Label>
            <Select
              size="sm"
              width={240}
              className="ml-auto"
              value={selectedRun}
              options={[
                { value: 'live', label: running ? 'Current run (live)' : 'Latest run' },
                ...runs.filter((r) => r.runId !== runId).map((r) => ({ value: r.runId, label: `${formatDateTime(r.startedAt)} · ${r.status ?? '—'}` })),
              ]}
              onChange={(v) => void selectRun(v)}
            />
          </div>
          {metrics === null ? (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} height={196} className="rounded-lg" />
              ))}
            </div>
          ) : metricKeys.length ? (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {metricKeys.map((k) => {
                const m = METRIC_META[k] ?? {};
                return (
                  <LineChart
                    key={k}
                    title={m.title ?? humanize(k)}
                    help={m.help}
                    data={metrics[k].map((p) => ({ x: p.step, y: p.value }))}
                    formatY={m.format ?? ((v) => formatNumber(v))}
                    formatX={(v) => formatNumber(v)}
                    unit={m.unit}
                    log={m.log}
                  />
                );
              })}
            </div>
          ) : (
            <div className="flex h-[196px] items-center justify-center rounded-lg border border-dashed border-line-strong">
              <EmptyState icon={ChartIcon} title="No Training Metrics" size="sm" />
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex h-7 items-center gap-2">
            <Label>Hardware</Label>
            <span className="ellipsis text-xs text-fg-subtle">{last?.gpus[0]?.name ?? ''}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <LineChart title="GPU" data={hwSeries.gpu} yMin={0} yMax={100} unit="%" formatY={(v) => v.toFixed(0)} formatX={fmtAgo} />
            <LineChart title="VRAM" data={hwSeries.vram} yMin={0} yMax={(last?.gpus[0]?.vramTotalMB ?? 0) / 1024 || undefined} unit="GB" formatY={(v) => v.toFixed(1)} formatX={fmtAgo} />
            <LineChart title="CPU" data={hwSeries.cpu} yMin={0} yMax={100} unit="%" formatY={(v) => v.toFixed(0)} formatX={fmtAgo} />
            <LineChart title="RAM" data={hwSeries.ram} yMin={0} yMax={(last?.memory?.totalMB ?? 0) / 1024 || undefined} unit="GB" formatY={(v) => v.toFixed(1)} formatX={fmtAgo} />
            {hwSeries.temp.length > 0 && <LineChart title="GPU Temp" data={hwSeries.temp} unit="°C" formatY={(v) => v.toFixed(0)} formatX={fmtAgo} />}
            {hwSeries.power.length > 0 && <LineChart title="GPU Power" data={hwSeries.power} unit="W" formatY={(v) => v.toFixed(0)} formatX={fmtAgo} />}
          </div>
        </section>
      </div>
    </div>
  );
}
