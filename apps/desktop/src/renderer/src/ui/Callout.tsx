import { CircleAlert, CircleX, Info, Lightbulb, type LucideIcon } from 'lucide-react';
import type { MouseEvent as ReactMouseEvent, ReactNode, Ref } from 'react';
import { cn } from './cn';

export type CalloutLevel = 'info' | 'warning' | 'error';

const meta: Record<CalloutLevel, { icon: LucideIcon; ink: string; tint: string; edge: string }> = {
  info: { icon: Info, ink: 'text-info', tint: 'bg-info-soft', edge: 'bg-info' },
  warning: { icon: CircleAlert, ink: 'text-warning', tint: 'bg-warning-soft', edge: 'bg-warning' },
  error: { icon: CircleX, ink: 'text-danger', tint: 'bg-danger-soft', edge: 'bg-danger' },
};

export interface CalloutProps {
  level: CalloutLevel;
  title: string;
  detail?: string;
  /** What to do about it; shown with a lightbulb. */
  hint?: string;
  /** Small caption, e.g. "Align · 2m ago". */
  meta?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  /** Elevated surface for floating use. */
  floating?: boolean;
  className?: string;
}

/** A message: level icon, title, optional detail / hint / actions. */
export function Callout({ level, title, detail, hint, meta: caption, actions, compact, floating, className }: CalloutProps) {
  const m = meta[level];
  const Icon = m.icon;
  return (
    <div
      role={level === 'error' ? 'alert' : 'status'}
      className={cn(
        'relative flex gap-2.5 overflow-hidden rounded-lg',
        floating ? 'border border-line-strong bg-surface-3 shadow-lg' : 'bg-surface-2',
        compact ? 'p-2.5' : 'p-3.5',
        className,
      )}
    >
      <span className={cn('flex shrink-0 items-center justify-center rounded-full', m.tint, m.ink, compact ? 'size-5' : 'size-6')}>
        <Icon size={compact ? 12 : 14} strokeWidth={2.25} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-2">
          <span className={cn('min-w-0 flex-1 font-semibold text-fg', compact ? 'text-xs leading-5' : 'text-sm leading-6')}>{title}</span>
          {caption && <span className="tnum shrink-0 pt-0.5 text-2xs text-fg-subtle">{caption}</span>}
        </div>
        {detail && <p className={cn('select-text whitespace-pre-wrap break-words text-fg-muted', compact ? 'text-2xs' : 'text-xs')}>{detail}</p>}
        {hint && (
          <p className={cn('flex select-text items-start gap-1.5 text-fg', compact ? 'text-2xs' : 'text-xs')}>
            <Lightbulb size={compact ? 11 : 12} className="mt-[2px] shrink-0 text-warning" />
            <span className="min-w-0 break-words">{hint}</span>
          </p>
        )}
        {actions && <div className="mt-1.5 flex items-center gap-1.5">{actions}</div>}
      </div>
    </div>
  );
}

/** Fixed-size level indicator button (opens details elsewhere). */
export function LevelDot({ level, count, label, onClick, buttonRef }: { level: CalloutLevel; count?: number; label: string; onClick?: (e: ReactMouseEvent) => void; buttonRef?: Ref<HTMLButtonElement> }) {
  const m = meta[level];
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn('no-drag inline-flex size-4 shrink-0 items-center justify-center rounded-full outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-1 focus-visible:ring-line-focus', m.tint, m.ink)}
    >
      {count && count > 1 ? <span className="tnum text-[9px] font-bold leading-none">{count > 9 ? '9+' : count}</span> : <span className={cn('size-1.5 rounded-full', m.edge)} />}
    </button>
  );
}
