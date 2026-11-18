import { CircleHelp } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

type Side = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  content: ReactNode;
  side?: Side;
  /** Delay in ms before showing. */
  delay?: number;
  children: ReactNode;
  className?: string;
  /** Wider bubble for help text. */
  wide?: boolean;
  disabled?: boolean;
}

/**
 * Tooltip rendered in a fixed-position portal, so it never affects layout and
 * is never clipped by scroll containers.
 */
export function Tooltip({ content, side = 'top', delay = 350, children, className, wide, disabled }: TooltipProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = useCallback(() => {
    if (disabled || content == null || content === '') return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  }, [delay, disabled, content]);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  }, []);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !bubble.current) return;
    const a = anchor.current.getBoundingClientRect();
    const b = bubble.current.getBoundingClientRect();
    const gap = 6;
    let x = a.left + a.width / 2 - b.width / 2;
    let y = side === 'bottom' ? a.bottom + gap : a.top - b.height - gap;
    if (side === 'left') {
      x = a.left - b.width - gap;
      y = a.top + a.height / 2 - b.height / 2;
    } else if (side === 'right') {
      x = a.right + gap;
      y = a.top + a.height / 2 - b.height / 2;
    }
    if (side === 'top' && y < 4) y = a.bottom + gap;
    if (side === 'bottom' && y + b.height > window.innerHeight - 4) y = a.top - b.height - gap;
    x = Math.max(6, Math.min(x, window.innerWidth - b.width - 6));
    y = Math.max(4, Math.min(y, window.innerHeight - b.height - 4));
    setPos({ x, y });
  }, [open, side]);

  return (
    <span
      ref={anchor}
      className={cn('inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onMouseDown={hide}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={bubble}
            role="tooltip"
            className={cn(
              'pointer-events-none fixed z-[1000] rounded-sm border border-line-strong bg-surface-4 px-2 py-1 text-xs text-fg shadow-md',
              wide ? 'max-w-[280px]' : 'max-w-[220px]',
            )}
            style={{
              left: pos?.x ?? -9999,
              top: pos?.y ?? -9999,
              visibility: pos ? 'visible' : 'hidden',
              animation: 'sc-fade-in var(--sc-duration-fast) var(--sc-ease-out)',
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}

/** The only place explanations live: a small "?" with the text as tooltip. */
export function HelpTip({ text, side = 'top', className }: { text?: ReactNode; side?: Side; className?: string }) {
  if (!text) return null;
  return (
    <Tooltip content={text} side={side} delay={120} wide className={className}>
      <span
        tabIndex={0}
        aria-label="Help"
        className="no-drag inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full text-fg-faint transition-colors duration-150 hover:text-fg-muted focus-visible:text-fg-muted"
      >
        <CircleHelp size={12} strokeWidth={2} />
      </span>
    </Tooltip>
  );
}
