import type { LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/** Lightweight context menu at a screen position. */
export function ContextMenu({ state, onClose }: { state: ContextMenuState | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!state || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(state.x, window.innerWidth - r.width - 6), y: Math.min(state.y, window.innerHeight - r.height - 6) });
  }, [state]);
  useEffect(() => {
    if (!state) return;
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [state, onClose]);
  if (!state) return null;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      className="glass fixed z-[1100] min-w-[180px] rounded-lg border p-1"
      style={{ left: pos?.x ?? state.x, top: pos?.y ?? state.y, visibility: pos ? 'visible' : 'hidden', animation: 'sc-pop-spring var(--sc-duration-spring) var(--sc-ease-spring)', transformOrigin: 'top left' }}
    >
      {state.items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          disabled={it.disabled}
          onClick={() => {
            onClose();
            it.onSelect();
          }}
          className={cn(
            'flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-sm outline-none disabled:text-fg-faint',
            it.danger ? 'text-danger hover:bg-danger-soft' : 'text-fg hover:bg-accent-soft',
          )}
        >
          {it.icon && <it.icon size={14} />}
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
