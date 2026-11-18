import { useRef } from 'react';
import { cn } from './cn';

/**
 * Invisible 6px drag strip on a panel edge (parent must be `relative`).
 * Reports the new, clamped width; double-click resets.
 */
export function ResizeHandle({ edge, onResize, onReset, min, max }: { edge: 'left' | 'right'; onResize: (w: number) => void; onReset?: () => void; min: number; max: number }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={-1}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: (e.currentTarget.parentElement as HTMLElement).offsetWidth };
        document.body.style.cursor = 'col-resize';
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dx = e.clientX - start.current.x;
        const w = start.current.w + (edge === 'right' ? dx : -dx);
        onResize(Math.max(min, Math.min(max, Math.round(w))));
      }}
      onPointerUp={(e) => {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        start.current = null;
        document.body.style.cursor = '';
      }}
      onPointerCancel={() => {
        start.current = null;
        document.body.style.cursor = '';
      }}
      onDoubleClick={onReset}
      className={cn(
        'no-drag group absolute bottom-0 top-0 z-20 w-1.5 cursor-col-resize',
        edge === 'right' ? '-right-[3px]' : '-left-[3px]',
      )}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover:bg-accent group-active:bg-accent" />
    </div>
  );
}
