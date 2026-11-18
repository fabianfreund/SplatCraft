import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  children: ReactNode;
  width?: number;
  align?: 'start' | 'end';
  className?: string;
}

/** Anchored floating panel (portal). Closes on outside click / Escape. */
export function Popover({ open, onClose, anchor, children, width = 320, align = 'start', className }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor.current) return setPos(null);
    const a = anchor.current.getBoundingClientRect();
    const x = align === 'end' ? a.right - width : a.left;
    setPos({ x: Math.max(8, Math.min(x, window.innerWidth - width - 8)), y: a.bottom + 6 });
  }, [open, anchor, width, align]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      // Ignore clicks inside other portals (menus, tooltips) opened from here.
      if ((t as HTMLElement).closest?.('[role=menu],[role=listbox]')) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
    };
  }, [open, onClose, anchor]);
  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={cn('glass no-drag fixed z-[950] max-h-[70vh] overflow-y-auto rounded-xl border', className)}
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, width, visibility: pos ? 'visible' : 'hidden', animation: 'sc-pop-spring var(--sc-duration-spring) var(--sc-ease-spring)', transformOrigin: align === 'end' ? 'top right' : 'top left' }}
    >
      {children}
    </div>,
    document.body,
  );
}
