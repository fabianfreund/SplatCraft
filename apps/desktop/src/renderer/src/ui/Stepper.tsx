import { Check, X } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from './cn';
import { ProgressBar } from './ProgressBar';
import { Spinner } from './Spinner';
import { HelpTip, Tooltip } from './Tooltip';

export type StepperState = 'idle' | 'queued' | 'running' | 'done' | 'error' | 'disabled' | 'cancelled';

export interface StepperItemProps {
  index: number;
  title: string;
  help?: string;
  /** Short key figure, e.g. "46/50". */
  stat?: string;
  /** Stat shown greyed (e.g. a not-yet-processed count). */
  statMuted?: boolean;
  state: StepperState;
  fraction?: number;
  selected?: boolean;
  /** Connector below this row is "completed". */
  doneBelow?: boolean;
  last?: boolean;
  error?: string;
  trailing?: ReactNode;
  /** Fixed 16px slot before the stat (e.g. a notice indicator). */
  indicator?: ReactNode;
  /** Settings differ from the preset defaults (small accent dot). */
  modified?: boolean;
  onSelect?: () => void;
}

/** One row of a vertical numbered stepper. All slots are fixed-size. */
export function StepperItem({ index, title, help, stat, statMuted, state, fraction, selected, doneBelow, last, error, trailing, indicator, modified, onSelect }: StepperItemProps) {
  const done = state === 'done';
  const badge = (
    <span
      className={cn(
        'relative z-[1] flex size-6 shrink-0 items-center justify-center rounded-full border text-2xs font-semibold tnum transition-colors duration-200',
        done && 'border-accent bg-accent text-accent-ink',
        state === 'running' && 'border-accent bg-surface-1 text-accent',
        state === 'error' && 'border-danger bg-danger-soft text-danger',
        state === 'cancelled' && 'border-warning bg-surface-1 text-warning',
        (state === 'idle' || state === 'queued') && 'border-line-strong bg-surface-1 text-fg-muted',
        state === 'disabled' && 'border-line bg-surface-1 text-fg-faint',
      )}
    >
      {done ? <Check size={12} strokeWidth={3} style={{ animation: 'sc-check-pop var(--sc-duration-spring) var(--sc-ease-spring)' }} /> : state === 'running' ? <Spinner size={12} /> : state === 'error' ? <X size={12} strokeWidth={3} /> : index}
    </span>
  );
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect?.())}
      className={cn(
        'group relative flex cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none transition-colors duration-150 focus-visible:bg-surface-2',
        selected ? 'bg-surface-3' : 'hover:bg-surface-2',
        state === 'disabled' && 'opacity-50',
      )}
      style={{ height: 'var(--sc-row-h)' }}
    >
      {/* connector to the next row */}
      {!last && (
        <span
          aria-hidden
          className="absolute left-[21px] z-[1] w-px bg-line-strong"
          style={{ top: 'calc(var(--sc-row-h) / 2 + 12px)', height: 'calc(var(--sc-row-h) - 24px)' }}
        >
          {/* Accent fill draws from top to bottom when the step below is reached. */}
          <span
            className="absolute inset-0 origin-top bg-accent"
            style={{ transform: `scaleY(${doneBelow ? 1 : 0})`, transition: 'transform var(--sc-duration-slow) var(--sc-ease-out)' }}
          />
        </span>
      )}
      {error ? (
        <Tooltip content={error} wide>
          {badge}
        </Tooltip>
      ) : (
        badge
      )}
      <div className="ml-1 flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <div className="flex items-center gap-1">
          <span className={cn('ellipsis text-sm font-medium', selected ? 'text-fg' : 'text-fg-muted', state === 'running' && 'text-fg')}>{title}</span>
          {modified && (
            <Tooltip content="Customized settings">
              <span aria-label="Customized" className="size-1.5 shrink-0 rounded-full bg-accent" />
            </Tooltip>
          )}
          {/* Help is revealed on hover/focus: the slot is always reserved. */}
          <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
            <HelpTip text={help} />
          </span>
        </div>
        <div className="flex h-[14px] w-full items-center" aria-hidden={state === 'running'}>
          {state === 'running' ? (
            <ProgressBar value={fraction} height={2} />
          ) : state === 'error' && error ? (
            <span className="ellipsis text-2xs leading-[14px] text-danger">{error}</span>
          ) : null}
        </div>
      </div>
      <span className="flex w-4 shrink-0 items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {indicator}
      </span>
      <span className={cn('tnum w-[48px] shrink-0 text-right text-xs', statMuted ? 'text-fg-faint' : state === 'error' ? 'text-danger' : 'text-fg-subtle')}>
        {state === 'running' && fraction !== undefined ? `${Math.round(fraction * 100)}%` : (stat ?? '')}
      </span>
      {trailing !== undefined && <span className="flex w-5 shrink-0 items-center justify-center">{trailing}</span>}
    </div>
  );
}
