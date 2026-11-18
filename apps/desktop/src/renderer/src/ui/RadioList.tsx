import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { Tooltip } from './Tooltip';

export interface RadioListOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Right-aligned hint, e.g. "~20 min". */
  meta?: string;
  help?: string;
}

/** Vertical single-choice list (profiles, presets). Fixed-height rows; selection only changes colors. */
export function RadioList<T extends string>({ value, options, onChange, disabled, ariaLabel }: { value: T; options: RadioListOption<T>[]; onChange: (v: T) => void; disabled?: boolean; ariaLabel?: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('flex flex-col gap-0.5', disabled && 'opacity-50')}>
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        const row = (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'press flex h-[var(--sc-control-h)] w-full items-center gap-2 rounded-sm border px-2 text-left text-sm outline-none disabled:cursor-not-allowed',
              active ? 'border-line-strong bg-surface-3 text-fg' : 'border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            <span className={cn('flex size-3.5 shrink-0 items-center justify-center rounded-full border', active ? 'border-accent' : 'border-line-strong')}>
              <span className="size-1.5 rounded-full bg-accent" style={{ transform: `scale(${active ? 1 : 0})`, transition: 'transform var(--sc-duration-spring) var(--sc-ease-spring)' }} />
            </span>
            {Icon && <Icon size={13} className={active ? 'text-accent' : 'text-fg-subtle'} />}
            <span className="ellipsis flex-1 font-medium">{o.label}</span>
            {o.meta && <span className="tnum shrink-0 text-2xs text-fg-subtle">{o.meta}</span>}
          </button>
        );
        return o.help ? (
          <Tooltip key={o.value} content={o.help} side="right" wide>
            {row}
          </Tooltip>
        ) : (
          row
        );
      })}
    </div>
  );
}
