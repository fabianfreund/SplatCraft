import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from './cn';

export interface RangeSliderProps {
  min: number;
  max: number;
  /** [start, end], start ≤ end. */
  value: [number, number];
  onChange: (v: [number, number]) => void;
  /** Fires when a drag or key press ends. */
  onCommit?: (v: [number, number]) => void;
  step?: number;
  /** Smallest allowed end − start. */
  minGap?: number;
  /** Position line, e.g. a video playhead. */
  marker?: number;
  /** Pressing/dragging the track outside the handles scrubs the marker. */
  onSeek?: (v: number) => void;
  disabled?: boolean;
  /** Accessible names of the two handles. */
  labels?: [string, string];
  className?: string;
}

type Drag = 'start' | 'end' | 'seek';
const HANDLE_W = 8;

/**
 * Dual-handle range on a timeline track (trim in/out). Fixed height; the
 * selected span is tinted, the rest dimmed. Handles are keyboard sliders
 * (←/→, Shift = ×10, Home/End).
 */
export function RangeSlider({ min, max, value, onChange, onCommit, step = 0.01, minGap = 0, marker, onSeek, disabled, labels = ['Start', 'End'], className }: RangeSliderProps) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const latest = useRef(value);
  latest.current = value;

  const span = max - min;
  const pct = (v: number) => (span > 0 ? ((Math.min(max, Math.max(min, v)) - min) / span) * 100 : 0);
  const snap = (v: number) => {
    const s = step > 0 ? Math.round((v - min) / step) * step + min : v;
    return +Math.min(max, Math.max(min, s)).toFixed(6);
  };
  const at = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return snap(min + ((clientX - r.left) / Math.max(1, r.width)) * span);
  };
  const set = (which: 'start' | 'end', v: number) => {
    const [a, b] = latest.current;
    const next: [number, number] = which === 'start' ? [Math.min(v, b - minGap), b] : [a, Math.max(v, a + minGap)];
    next[0] = Math.max(min, next[0]);
    next[1] = Math.min(max, next[1]);
    if (next[0] !== a || next[1] !== b) {
      latest.current = next;
      onChange(next);
    }
    return next;
  };

  const down = (e: PointerEvent, which: Drag) => {
    if (disabled || span <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = which;
    track.current!.setPointerCapture(e.pointerId);
    if (which === 'seek') onSeek?.(at(e.clientX));
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d === 'seek') onSeek?.(at(e.clientX));
    else set(d, at(e.clientX));
  };
  const up = (e: PointerEvent) => {
    if (!drag.current) return;
    const d = drag.current;
    drag.current = null;
    track.current?.releasePointerCapture(e.pointerId);
    if (d !== 'seek') onCommit?.(latest.current);
  };
  const key = (e: KeyboardEvent, which: 'start' | 'end') => {
    const cur = latest.current[which === 'start' ? 0 : 1];
    const big = e.shiftKey ? 10 : 1;
    let v: number | undefined;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = cur - step * big;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = cur + step * big;
    else if (e.key === 'Home') v = min;
    else if (e.key === 'End') v = max;
    if (v === undefined) return;
    e.preventDefault();
    const next = set(which, snap(v)); // outside `onCommit?.(…)`, which would skip it
    onCommit?.(next);
  };

  const [a, b] = value;
  const handle = (which: 'start' | 'end', v: number) => (
    <span
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={labels[which === 'start' ? 0 : 1]}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={v}
      aria-disabled={disabled}
      onPointerDown={(e) => down(e, which)}
      onKeyDown={(e) => key(e, which)}
      className={cn(
        'absolute inset-y-0 z-[2] flex cursor-ew-resize items-center justify-center rounded-xs bg-accent outline-none transition-shadow duration-150 focus-visible:shadow-glow',
        disabled && 'cursor-default',
      )}
      style={{ width: HANDLE_W, left: `calc(${pct(v)}% - ${which === 'start' ? HANDLE_W : 0}px)` }}
    >
      <span className="h-2.5 w-px rounded-full bg-accent-ink/60" />
    </span>
  );

  return (
    <div className={cn('no-drag relative h-7 select-none', disabled && 'opacity-40', className)} style={{ paddingInline: HANDLE_W }}>
      <div
        ref={track}
        className={cn('relative h-full touch-none', !disabled && onSeek && 'cursor-pointer')}
        onPointerDown={(e) => onSeek && down(e, 'seek')}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <div className="absolute inset-0 rounded-sm bg-surface-3" />
        <div className="absolute inset-y-0 border-y-2 border-accent bg-accent-soft" style={{ left: `${pct(a)}%`, right: `${100 - pct(b)}%` }} />
        {marker !== undefined && span > 0 && (
          <span aria-hidden className="pointer-events-none absolute -inset-y-1 z-[3] w-0.5 -translate-x-1/2 rounded-full bg-fg shadow-sm" style={{ left: `${pct(marker)}%` }} />
        )}
        {handle('start', a)}
        {handle('end', b)}
      </div>
    </div>
  );
}
