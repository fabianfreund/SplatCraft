import type { LucideIcon } from 'lucide-react';
import { forwardRef, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn';
import { Tooltip } from './Tooltip';

/**
 * Floating canvas toolbar (Figma-style glass pill). Place it absolutely.
 * Its width morphs smoothly when the tools inside change.
 */
export function Toolbar({ children, ariaLabel, className }: { children: ReactNode; ariaLabel: string; className?: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const [w, setW] = useState<number>();
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.offsetWidth));
    ro.observe(el);
    setW(el.offsetWidth);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      className={cn('glass no-drag h-12 overflow-hidden rounded-xl border', className)}
      style={{
        width: w === undefined ? undefined : w + 2, // + border
        transition: 'width var(--sc-duration-spring) var(--sc-ease-snap)',
        animation: 'sc-pop-spring var(--sc-duration-spring) var(--sc-ease-spring)',
      }}
    >
      <div ref={inner} className="flex h-full w-max items-center gap-0.5 p-1.5">
        {children}
      </div>
    </div>
  );
}

export function ToolbarDivider() {
  return <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-line-strong" />;
}

/** Keyed wrapper: its contents fade/slide in when the key changes (e.g. per step). */
export function ToolbarSection({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-0.5" style={{ animation: 'sc-pop-spring var(--sc-duration-spring) var(--sc-ease-spring)' }}>
      {children}
    </div>
  );
}

function Tip({ label, shortcut, children }: { label: string; shortcut?: string; children: ReactNode }) {
  return (
    <Tooltip
      content={
        <span className="flex items-center gap-2">
          {label}
          {shortcut && <span className="text-fg-subtle">{shortcut}</span>}
        </span>
      }
      side="top"
    >
      {children}
    </Tooltip>
  );
}

export interface ToolbarButtonProps {
  icon: LucideIcon;
  /** Tooltip / accessible name. */
  label: string;
  /** Shown next to the label in the tooltip, e.g. "F". */
  shortcut?: string;
  /** Visible text (for primary actions). Icon-only when omitted. */
  text?: string;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'danger';
  onClick?: () => void;
}

/** 36px action. The main action uses `tone="primary"` and `text`. */
export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarButton({ icon: Icon, label, shortcut, text, disabled, tone = 'default', onClick }, ref) {
  return (
    <Tip label={label} shortcut={shortcut}>
      <button
        ref={ref}
        type="button"
        aria-label={text ? undefined : label}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'press flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg text-sm font-medium outline-none focus-visible:ring-1 focus-visible:ring-line-focus disabled:cursor-not-allowed disabled:opacity-35',
          text ? 'px-3.5' : 'w-9',
          tone === 'primary' && 'bg-accent text-accent-ink shadow-[var(--sc-inset-highlight)] hover:bg-accent-strong',
          tone === 'danger' && 'bg-danger-soft text-danger hover:bg-danger hover:text-bg',
          tone === 'default' && 'text-fg-muted hover:bg-surface-4/60 hover:text-fg',
        )}
      >
        <Icon size={16} strokeWidth={2} />
        {text}
      </button>
    </Tip>
  );
});

export interface ToolbarToggle {
  id: string;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  active: boolean;
  onToggle: () => void;
}

/**
 * Row of toggles whose active highlights fuse into one capsule when
 * neighbours are on, and split apart with a springy morph when one turns off.
 */
export function ToolbarToggleGroup({ items }: { items: ToolbarToggle[] }) {
  return (
    <div className="flex items-center">
      {items.map((it, i) => {
        const prev = items[i - 1]?.active ?? false;
        const next = items[i + 1]?.active ?? false;
        const Icon = it.icon;
        const r = 11;
        return (
          <Tip key={it.id} label={it.label} shortcut={it.shortcut}>
            <button
              type="button"
              aria-label={it.label}
              aria-pressed={it.active}
              onClick={it.onToggle}
              className={cn(
                'press group relative flex h-9 w-9 shrink-0 items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-line-focus',
                it.active ? 'text-accent' : 'text-fg-muted hover:text-fg',
              )}
              style={{ borderRadius: r }}
            >
              <span
                aria-hidden
                className={cn('absolute inset-y-0', it.active ? 'bg-accent-soft' : 'bg-surface-4/60 opacity-0 group-hover:opacity-100')}
                style={{
                  left: it.active && prev ? 0 : 2,
                  right: it.active && next ? 0 : 2,
                  borderRadius: `${it.active && prev ? 0 : r}px ${it.active && next ? 0 : r}px ${it.active && next ? 0 : r}px ${it.active && prev ? 0 : r}px`,
                  transition:
                    'left var(--sc-duration-spring) var(--sc-ease-spring), right var(--sc-duration-spring) var(--sc-ease-spring), border-radius var(--sc-duration-spring) var(--sc-ease-spring), background-color var(--sc-duration-fast) ease-out, opacity var(--sc-duration-fast) ease-out',
                }}
              />
              <Icon size={16} strokeWidth={2} className="relative transition-transform duration-[var(--sc-duration-spring)] ease-spring" style={{ transform: it.active ? 'scale(1)' : 'scale(0.92)' }} />
            </button>
          </Tip>
        );
      })}
    </div>
  );
}
