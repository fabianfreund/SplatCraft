import { AlertTriangle, ChevronUp, Circle, CircleCheck, CircleX } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatClock } from '../../lib/format';
import { useApp } from '../../store/app';
import { hw, SPARK_WINDOW, useMonitor } from '../../store/monitor';
import { descriptorFor, usePipeline } from '../../store/pipeline';
import { Badge, cn, Divider, IconButton, Meter, ProgressBar, Tooltip } from '../../ui';
import { LogConsole } from './LogConsole';

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function StatusDock() {
  const expanded = useApp((s) => s.dockExpanded);
  const setExpanded = useApp((s) => s.setDockExpanded);
  return (
    <footer
      className="flex shrink-0 flex-col border-t border-line bg-surface-1 transition-[height] duration-300 ease-out"
      style={{ height: expanded ? 'var(--sc-dock-expanded-h)' : 'var(--sc-dock-h)' }}
    >
      <div className="flex h-[var(--sc-dock-h)] shrink-0 items-center">
        <div className="flex h-full w-9 items-center justify-center">
          <IconButton icon={ChevronUp} label={expanded ? 'Hide Console' : 'Show Console'} size="xs" className={cn('transition-transform duration-200', expanded && 'rotate-180')} onClick={() => setExpanded(!expanded)} />
        </div>
        <RunStatus />
        <Divider vertical className="mx-1" />
        <HardwareMeters />
      </div>
      {expanded && <LogConsole />}
    </footer>
  );
}

function RunStatus() {
  const running = usePipeline((s) => s.running);
  const runSteps = usePipeline((s) => s.runSteps);
  const steps = usePipeline((s) => s.steps);
  const stages = usePipeline((s) => s.stages);
  const runStatus = usePipeline((s) => s.runStatus);
  const now = useNow(running);

  const current = runSteps.find((s) => steps[s.key]?.status === 'running');
  const rt = current ? steps[current.key] : undefined;
  const fraction = rt?.fraction;
  let eta: string | undefined;
  if (rt?.startedAt && fraction !== undefined && fraction > 0.03 && fraction < 1) {
    const el = now - rt.startedAt;
    const left = (el * (1 - fraction)) / fraction;
    if (left >= 1000) eta = formatClock(left);
  }
  const doneCount = runSteps.filter((s) => ['done', 'cached'].includes(steps[s.key]?.status ?? '')).length;
  const title = current ? (descriptorFor(stages, current.stageId)?.title ?? current.title) : running ? 'Starting…' : runStatus === 'completed' ? 'Completed' : runStatus === 'failed' ? 'Failed' : runStatus === 'cancelled' ? 'Stopped' : 'Idle';
  const Icon = runStatus === 'completed' ? CircleCheck : runStatus === 'failed' ? CircleX : runStatus === 'cancelled' ? AlertTriangle : Circle;

  return (
    <div className="flex h-full w-[372px] shrink-0 items-center gap-2 pr-2">
      <span className="flex size-4 shrink-0 items-center justify-center">
        {!running && <Icon size={13} className={runStatus === 'completed' ? 'text-success' : runStatus === 'failed' ? 'text-danger' : runStatus === 'cancelled' ? 'text-warning' : 'text-fg-faint'} />}
        {running && <span className="size-2 rounded-full bg-accent shadow-glow" style={{ animation: 'sc-pulse 1.4s var(--sc-ease-in-out) infinite' }} />}
      </span>
      <span className="ellipsis w-[110px] text-xs font-medium text-fg">{title}</span>
      <span className="tnum w-[28px] text-2xs text-fg-subtle">{runSteps.length ? `${doneCount}/${runSteps.length}` : ''}</span>
      <div className="w-[96px] shrink-0">
        <ProgressBar value={running ? (fraction ?? 0) : runStatus === 'completed' ? 1 : 0} tone={runStatus === 'failed' ? 'danger' : 'accent'} height={4} active={running} />
      </div>
      <span className="tnum w-[34px] text-right text-xs text-fg-muted">{running && fraction !== undefined ? `${Math.round(fraction * 100)}%` : ''}</span>
      <Tooltip content="Estimated time left in this step">
        <span className="tnum w-[48px] text-2xs text-fg-subtle">{eta ? `~${eta}` : ''}</span>
      </Tooltip>
    </div>
  );
}

function HardwareMeters() {
  const samples = useMonitor((s) => s.samples);
  const latest = useMonitor((s) => s.latest);
  const recent = useMemo(() => samples.slice(-SPARK_WINDOW), [samples]);
  const series = (f: (s: (typeof samples)[number]) => number | undefined) => recent.map(f);
  if (!latest) return <div className="flex-1" />;
  const g = latest.gpus[0];
  const vramPct = hw.vramPct(latest);
  const diskGB = hw.diskFreeGB(latest);
  const vramWarn = vramPct !== undefined && vramPct > 90;
  const diskWarn = diskGB !== undefined && diskGB < 5;
  const fmt = (v: number | undefined, d = 0) => (v === undefined ? '—' : v.toFixed(d));

  return (
    <div className="flex h-full min-w-0 flex-1 items-center">
      <div className="flex h-full min-w-0 flex-1 items-center overflow-hidden">
        {g && <Meter label="GPU" value={fmt(g.utilization)} unit="%" valueWidth={34} series={series(hw.gpuUtil)} min={0} max={100} tooltip={g.name} />}
        {g?.vramTotalMB !== undefined && (
          <Meter
            label="VRAM"
            value={`${fmt(hw.vramGB(latest), 1)}/${fmt(g.vramTotalMB / 1024, 0)}`}
            unit="GB"
            valueWidth={66}
            series={series(hw.vramPct)}
            min={0}
            max={100}
            tone={vramWarn ? 'warning' : 'accent'}
          />
        )}
        {g?.temperatureC !== undefined && <Meter label="Temp" value={fmt(g.temperatureC)} unit="°C" valueWidth={40} />}
        {g?.powerW !== undefined && (
          <span className="flex h-full max-[1500px]:hidden">
            <Meter label="Power" value={fmt(g.powerW)} unit="W" valueWidth={40} />
          </span>
        )}
        {latest.cpu && <Meter label="CPU" value={fmt(latest.cpu.utilization)} unit="%" valueWidth={34} series={series(hw.cpu)} min={0} max={100} tooltip={latest.cpu.model} />}
        {latest.memory && <Meter label="RAM" value={`${fmt(hw.ramGB(latest), 1)}/${fmt(latest.memory.totalMB / 1024, 0)}`} unit="GB" valueWidth={66} series={series(hw.ramPct)} min={0} max={100} />}
        {diskGB !== undefined && <Meter label="Disk" value={fmt(diskGB, 0)} unit="GB" valueWidth={44} tone={diskWarn ? 'danger' : 'accent'} tooltip={latest.disk?.path} />}
      </div>
      {/* Warnings live in a reserved slot */}
      <div className="flex h-full w-[120px] shrink-0 items-center justify-end gap-1 pr-3">
        {vramWarn && (
          <Badge tone="warning" icon={AlertTriangle}>
            VRAM
          </Badge>
        )}
        {diskWarn && (
          <Badge tone="danger" icon={AlertTriangle}>
            Disk
          </Badge>
        )}
      </div>
    </div>
  );
}
