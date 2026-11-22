import { Check, ChevronsUpDown } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  value: T | undefined;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  placeholder?: string;
  size?: 'sm' | 'md';
  changed?: boolean;
  className?: string;
  width?: number | string;
  ariaLabel?: string;
}

const ROW = 28;

/**
 * Custom dropdown: glass listbox that springs open from the trigger, with
 * the selected row placed over the trigger when there is room (macOS style).
 * Keyboard: ↑/↓/Home/End move, Enter/Space pick, Esc closes, letters jump.
 */
export function Select<T extends string>({ value, options, onChange, placeholder, size = 'sm', changed, className, width, ariaLabel }: SelectProps<T>) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ x: number; y: number; w: number; origin: string } | null>(null);
  const selectedIdx = options.findIndex((o) => o.value === value);
  const current = options[selectedIdx];

  const show = () => {
    setActive(Math.max(0, selectedIdx));
    setOpen(true);
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };
  const pick = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    if (o.value !== value) onChange(o.value);
    close();
  };

  useLayoutEffect(() => {
    if (!open || !trigger.current) return setPos(null);
    const r = trigger.current.getBoundingClientRect();
    const h = options.length * ROW + 8;
    const sel = Math.max(0, selectedIdx);
    // Align the selected row with the trigger; fall back to below/above when it would clip.
    let y = r.top - 4 - sel * ROW + (r.height - ROW) / 2;
    if (y < 8 || y + h > window.innerHeight - 8) y = r.bottom + h + 6 < window.innerHeight ? r.bottom + 4 : r.top - h - 4;
    const w = Math.max(r.width, 140);
    const x = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    setPos({ x, y, w, origin: `${r.left - x + r.width / 2}px ${r.top + r.height / 2 - y}px` });
  }, [open, options.length, selectedIdx]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !trigger.current?.contains(t)) close(false);
    };
    const blur = () => close(false);
    window.addEventListener('mousedown', down);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('blur', blur);
    };
  }, [open]);

  const move = (from: number, dir: 1 | -1) => {
    for (let i = 1; i <= options.length; i++) {
      const n = (from + dir * i + options.length) % options.length;
      if (!options[n].disabled) return n;
    }
    return from;
  };
  const onListKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((a) => move(a, 1));
    else if (e.key === 'ArrowUp') setActive((a) => move(a, -1));
    else if (e.key === 'Home') setActive(move(-1, 1));
    else if (e.key === 'End') setActive(move(options.length, -1));
    else if (e.key === 'Enter' || e.key === ' ') pick(active);
    else if (e.key === 'Escape' || e.key === 'Tab') {
      e.stopPropagation(); // don't also close a surrounding dialog
      close();
    }
    else if (e.key.length === 1) {
      const i = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setActive(i);
      return;
    } else return;
    e.preventDefault();
  };

  return (
    <div className={cn('no-drag relative inline-flex shrink-0', className)} style={{ width }}>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : show())}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onKeyDown={(e) => {
          // Focus stays on the trigger (ARIA combobox pattern); the list follows the active descendant.
          if (open) onListKey(e);
          else if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
            e.preventDefault();
            show();
          }
        }}
        className={cn(
          'press flex w-full items-center rounded-sm border pl-2 pr-6 text-left outline-none focus-visible:border-line-focus',
          size === 'sm' ? 'h-[var(--sc-control-h-sm)] text-xs' : 'h-[var(--sc-control-h)] text-sm',
          changed ? 'border-accent-soft bg-accent-softer text-accent-strong' : 'border-line-strong bg-surface-1 text-fg hover:bg-surface-2',
          open && 'border-line-focus',
        )}
      >
        <span className="ellipsis">{current?.label ?? placeholder ?? '—'}</span>
        <ChevronsUpDown size={12} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
      </button>
      {open &&
        createPortal(
          <div
            ref={list}
            id={listId}
            role="listbox"
            onMouseDown={(e) => e.preventDefault() /* keep focus on the trigger */}
            className="glass no-drag fixed z-[1100] rounded-lg border p-1 outline-none"
            style={{
              left: pos?.x ?? -9999,
              top: pos?.y ?? -9999,
              minWidth: pos?.w,
              visibility: pos ? 'visible' : 'hidden',
              transformOrigin: pos?.origin,
              animation: 'sc-pop-spring var(--sc-duration-spring) var(--sc-ease-spring)',
            }}
          >
            {options.map((o, i) => {
              const sel = o.value === value;
              return (
                <div
                  key={o.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={sel}
                  aria-disabled={o.disabled}
                  onMouseEnter={() => !o.disabled && setActive(i)}
                  onClick={() => pick(i)}
                  className={cn(
                    'flex items-center gap-2 rounded-md pl-1.5 pr-3 text-sm transition-colors duration-75',
                    o.disabled ? 'text-fg-faint' : i === active ? 'bg-accent-soft text-fg' : 'text-fg-muted',
                  )}
                  style={{ height: ROW }}
                >
                  <span className="flex w-4 shrink-0 justify-center">{sel && <Check size={13} strokeWidth={2.5} className="text-accent" />}</span>
                  <span className="ellipsis">{o.label}</span>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
