import type { LucideIcon } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
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
  /**
   * Fixed width of every segment in px. Omit to measure: all segments get the
   * width of the widest label plus padding (equal widths → the pill never jumps).
   */
  segmentWidth?: number;
  disabled?: boolean;
  ariaLabel?: string;
}

const INSET = 3; // gap between track and pill
const PAD = { sm: 12, md: 14 } as const; // horizontal padding inside a segment

export function SegmentedControl<T extends string>({ value, options, onChange, size = 'md', segmentWidth, disabled, ariaLabel }: SegmentedControlProps<T>) {
  const found = options.findIndex((o) => o.value === value);
  const idx = Math.max(0, found);
  const content = useRef<(HTMLSpanElement | null)[]>([]);
  const [measured, setMeasured] = useState<number>();
  // Direction of the last move → which pill edge leads (liquid stretch).
  const prevIdx = useRef(idx);
  const dir = idx > prevIdx.current ? 1 : idx < prevIdx.current ? -1 : 0;
  useLayoutEffect(() => {
    prevIdx.current = idx;
  }, [idx]);
  const keys = options.map((o) => `${o.value}:${o.label ?? ''}:${o.icon ? 1 : 0}`).join('|');

  useLayoutEffect(() => {
    if (segmentWidth) return;
    const els = content.current.slice(0, options.length).filter(Boolean) as HTMLSpanElement[];
    const measure = () => setMeasured(Math.ceil(Math.max(0, ...els.map((e) => e.scrollWidth))) + PAD[size] * 2);
    measure();
    // Re-measure when fonts or the text scale change.
    const ro = new ResizeObserver(measure);
    els.forEach((e) => ro.observe(e));
    return () => ro.disconnect();
  }, [keys, size, segmentWidth, options.length]);

  const w = segmentWidth ?? measured;
  const h = size === 'sm' ? 'var(--sc-control-h)' : 'calc(var(--sc-control-h) + 4px)';
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('no-drag relative inline-flex w-max shrink-0 self-start rounded-md border border-line bg-surface-1', disabled && 'opacity-50')}
      style={{ height: h, padding: INSET - 1 }}
    >
      {w !== undefined && (
        <span
          aria-hidden
          className="absolute rounded-sm bg-surface-3 shadow-sm ring-1 ring-line-strong"
          style={{
            top: INSET - 1,
            bottom: INSET - 1,
            left: INSET - 1 + idx * w,
            right: INSET - 1 + (options.length - 1 - idx) * w,
            opacity: found < 0 ? 0 : 1,
            // Leading edge moves first, trailing edge follows 55ms later.
            transition: [
              `left var(--sc-duration-spring) var(--sc-ease-spring) ${dir > 0 ? 55 : 0}ms`,
              `right var(--sc-duration-spring) var(--sc-ease-spring) ${dir < 0 ? 55 : 0}ms`,
              'opacity var(--sc-duration-fast) ease-out',
            ].join(', '),
          }}
        />
      )}
      {options.map((o, i) => {
        const active = o.value === value;
        const Icon = o.icon;
        const btn = (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label ? undefined : o.tooltip}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'press relative z-[1] inline-flex h-full shrink-0 items-center justify-center rounded-sm font-medium outline-none focus-visible:ring-1 focus-visible:ring-line-focus',
              size === 'sm' ? 'text-xs' : 'text-sm',
              active ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
            )}
            style={{ width: w, paddingInline: w === undefined ? PAD[size] : 0 }}
          >
            <span
              ref={(el) => {
                content.current[i] = el;
              }}
              className="inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              {Icon && <Icon size={size === 'sm' ? 13 : 14} strokeWidth={2} className={active ? 'text-accent' : undefined} />}
              {o.label}
            </span>
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
