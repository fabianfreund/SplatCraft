import { AlertTriangle, Ban, Check, CircleDashed, CircleDot, Clock3, Database, History, X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { Spinner } from './Spinner';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const toneCls: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-fg-muted',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

export function Badge({ tone = 'neutral', icon: Icon, children, className, width }: { tone?: Tone; icon?: LucideIcon; children?: ReactNode; className?: string; width?: number }) {
  return (
    <span
      className={cn('inline-flex h-[18px] shrink-0 items-center justify-center gap-1 rounded-xs px-1.5 text-2xs font-semibold', toneCls[tone], className)}
      style={{ width }}
    >
      {Icon && <Icon size={10} strokeWidth={2.5} className="shrink-0" />}
      {children}
    </span>
  );
}

/** `stale`: ran before, but settings or inputs changed since (needs a re-run). */
export type StepStatus = 'idle' | 'queued' | 'cached' | 'running' | 'done' | 'stale' | 'error' | 'disabled' | 'cancelled';

const statusMeta: Record<StepStatus, { tone: Tone; label: string; icon?: LucideIcon }> = {
  idle: { tone: 'neutral', label: 'Idle', icon: CircleDashed },
  queued: { tone: 'neutral', label: 'Queued', icon: Clock3 },
  cached: { tone: 'success', label: 'Cached', icon: Database },
  running: { tone: 'accent', label: 'Running' },
  done: { tone: 'success', label: 'Done', icon: Check },
  stale: { tone: 'warning', label: 'Outdated', icon: History },
  error: { tone: 'danger', label: 'Error', icon: X },
  disabled: { tone: 'neutral', label: 'Off', icon: Ban },
  cancelled: { tone: 'warning', label: 'Stopped', icon: AlertTriangle },
};

/** Fixed-width status chip: never changes size between states. */
export function StatusChip({ status, fraction }: { status: StepStatus; fraction?: number }) {
  const m = statusMeta[status];
  return (
    <span
      className={cn(
        'tnum inline-flex h-5 w-[76px] shrink-0 items-center justify-center gap-1 overflow-hidden rounded-xs text-2xs font-semibold',
        toneCls[m.tone],
        status === 'disabled' && 'text-fg-faint',
      )}
    >
      {status === 'running' ? <Spinner size={10} /> : m.icon ? <m.icon size={10} strokeWidth={2.5} className="shrink-0" /> : <CircleDot size={10} />}
      <span>{status === 'running' && fraction !== undefined ? `${Math.round(fraction * 100)}%` : m.label}</span>
    </span>
  );
}
