import { ChevronLeft, ChevronRight, Eye, EyeOff, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, cn, IconButton, Kbd } from '../../ui';

export interface LightboxItem {
  key: string;
  name: string;
  /** Image URL; omit to show `placeholder` (e.g. a video). */
  src?: string;
  placeholder?: ReactNode;
  /** 0..1 quality score, if known. */
  score?: number;
  /** Why the item is out (e.g. "blurry", "excluded"); undefined when kept. */
  reason?: string;
  /** Rejected / excluded look. */
  dimmed?: boolean;
}

interface MediaLightboxProps {
  items: LightboxItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** Include/exclude the current item. Omit where excluding isn't possible (the slot stays reserved). */
  onToggle?: (item: LightboxItem) => void;
}

/** Large view of one gallery item over the gallery: ←/→ navigate, X toggles, Esc closes. */
export function MediaLightbox({ items, index, onIndex, onClose, onToggle }: MediaLightboxProps) {
  const item = items[index];
  const root = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string>();
  const live = useRef({ items, index, onIndex, onClose, onToggle });
  live.current = { items, index, onIndex, onClose, onToggle };

  // Focus the overlay on open, give focus back on close.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => prev?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const { items: list, index: i, onIndex: go, onClose: close, onToggle: toggle } = live.current;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft' && i > 0) go(i - 1);
      else if (e.key === 'ArrowRight' && i < list.length - 1) go(i + 1);
      else if ((e.key === 'x' || e.key === 'X') && toggle && list[i]) toggle(list[i]);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (!item) return null;
  const out = !!item.reason;
  const showImg = item.src && failed !== item.src;
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal
      aria-label={item.name}
      tabIndex={-1}
      className="absolute inset-0 z-30 flex flex-col bg-bg outline-none"
      style={{ animation: 'sc-fade-in var(--sc-duration-base) var(--sc-ease-out)' }}
    >
      {/* Header: fixed height, every slot reserved */}
      <div className="flex h-12 shrink-0 items-center gap-3 px-5">
        <span className="min-w-0 truncate text-sm font-medium text-fg" title={item.name}>
          {item.name}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {item.score !== undefined && (
            <Badge tone={item.score >= 0.5 ? 'success' : item.score >= 0.3 ? 'warning' : 'danger'} className="tnum" width={32}>
              {Math.round(item.score * 100)}
            </Badge>
          )}
          {item.reason && <Badge tone={item.reason === 'excluded' ? 'neutral' : 'danger'}>{item.reason}</Badge>}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="tnum min-w-[72px] text-right text-xs text-fg-subtle">
            {index + 1} / {items.length}
          </span>
          <Button
            size="sm"
            variant={out ? 'subtle' : 'secondary'}
            icon={out ? Eye : EyeOff}
            minWidth={92}
            aria-hidden={!onToggle}
            tabIndex={onToggle ? undefined : -1}
            className={cn(!onToggle && 'invisible')}
            onClick={() => onToggle?.(item)}
            tooltip={
              onToggle && (
                <span className="flex items-center gap-2">
                  {out ? 'Include in training' : 'Exclude from training'}
                  <Kbd>X</Kbd>
                </span>
              )
            }
          >
            {out ? 'Include' : 'Exclude'}
          </Button>
          <IconButton icon={X} label="Close (Esc)" tooltipSide="bottom" onClick={onClose} />
        </div>
      </div>
      {/* Stage */}
      <div className="relative min-h-0 flex-1 px-16 pb-6">
        <div className="flex size-full items-center justify-center overflow-hidden rounded-md bg-surface-1">
          {showImg ? (
            <img
              key={item.key}
              src={item.src}
              alt={item.name}
              draggable={false}
              onError={() => setFailed(item.src)}
              className={cn('size-full object-contain transition-[filter,opacity] duration-300 ease-out', item.dimmed && 'opacity-35 grayscale')}
              style={{ animation: 'sc-fade-in var(--sc-duration-fast) var(--sc-ease-out)' }}
            />
          ) : (
            <span className="text-fg-subtle">{item.placeholder}</span>
          )}
        </div>
        <div className="absolute inset-y-0 left-4 flex items-center pb-6">
          <IconButton icon={ChevronLeft} label="Previous (←)" size="md" variant="secondary" tooltipSide="right" disabled={index <= 0} onClick={() => onIndex(index - 1)} />
        </div>
        <div className="absolute inset-y-0 right-4 flex items-center pb-6">
          <IconButton icon={ChevronRight} label="Next (→)" size="md" variant="secondary" tooltipSide="left" disabled={index >= items.length - 1} onClick={() => onIndex(index + 1)} />
        </div>
      </div>
    </div>
  );
}
