import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { Tooltip } from './Tooltip';

export interface Segment<T extends string> {
  value: T;
  label?: string;
  icon?: LucideIcon;
  tooltip?: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: Segment<T>[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  /** Width of every segment in px — equal, fixed widths prevent shifting. */
  segmentWidth?: number;
  disabled?: boolean;
  ariaLabel?: string;
}

export function SegmentedControl<T extends string>({ value, options, onChange, size = 'md', segmentWidth = 72, disabled, ariaLabel }: SegmentedControlProps<T>) {
  const found = options.findIndex((o) => o.value === value);
  const idx = Math.max(0, found);
  const h = size === 'sm' ? 'var(--sc-control-h-sm)' : 'var(--sc-control-h)';
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('no-drag relative inline-flex shrink-0 rounded-sm border border-line bg-surface-1 p-[2px]', disabled && 'opacity-50')}
      style={{ height: h }}
    >
      <span
        aria-hidden
        className="absolute bottom-[2px] top-[2px] rounded-xs border border-line-strong bg-surface-4 shadow-sm transition-[transform,opacity] duration-200 ease-out"
        style={{ width: segmentWidth, transform: `translateX(${idx * segmentWidth}px)`, opacity: found < 0 ? 0 : 1 }}
      />
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        const btn = (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative z-[1] inline-flex h-full items-center justify-center gap-1.5 font-medium outline-none transition-colors duration-150',
              size === 'sm' ? 'text-xs' : 'text-sm',
              active ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
            )}
            style={{ width: segmentWidth }}
          >
            {Icon && <Icon size={13} strokeWidth={2} />}
            {o.label}
          </button>
        );
        return o.tooltip ? (
          <Tooltip key={o.value} content={o.tooltip} side="bottom">
            {btn}
          </Tooltip>
        ) : (
          btn
        );
      })}
    </div>
  );
}
