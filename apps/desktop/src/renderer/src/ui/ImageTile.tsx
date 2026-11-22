import { useState, type ReactNode } from 'react';
import { cn } from './cn';
import { Tooltip } from './Tooltip';

export interface ImageTileProps {
  /** Image URL; omit to show `placeholder` (e.g. a video icon). */
  src?: string;
  placeholder?: ReactNode;
  /** Bottom-right overlay (e.g. a size/duration label). */
  corner?: ReactNode;
  /** Rejected / excluded look. */
  dimmed?: boolean;
  /** 0..1 quality bar along the bottom edge. */
  score?: number;
  badge?: ReactNode;
  /** Small corner marker, e.g. for manual overrides. */
  marked?: boolean;
  /** Picked (e.g. first frame of a link being made): accent ring. */
  selected?: boolean;
  tooltip?: ReactNode;
  onClick?: () => void;
}

/** Fixed 3:2 thumbnail tile with optional quality bar and badge. */
export function ImageTile({ src, placeholder, corner, dimmed, score, badge, marked, selected, tooltip, onClick }: ImageTileProps) {
  const [failed, setFailed] = useState(false);
  const tone = score === undefined ? '' : score >= 0.5 ? 'bg-success' : score >= 0.3 ? 'bg-warning' : 'bg-danger';
  return (
    <Tooltip content={tooltip} className="block w-full" delay={250}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          'press group relative block aspect-[3/2] w-full overflow-hidden rounded-md bg-surface-2 outline-none focus-visible:ring-line-focus',
          selected ? 'ring-2 ring-accent' : 'ring-1 ring-line hover:ring-line-strong',
        )}
      >
        {src && !failed ? (
        <img
          src={src}
          onError={() => setFailed(true)}
          alt=""
          loading="lazy"
          draggable={false}
          className={cn('size-full object-cover transition-[filter,opacity,transform] duration-300 ease-out group-hover:scale-[1.03]', dimmed && 'opacity-35 grayscale')}
          style={{ animation: 'sc-fade-in var(--sc-duration-base) var(--sc-ease-out)' }}
        />
        ) : (
          <span className="flex size-full items-center justify-center text-fg-subtle">{placeholder}</span>
        )}
        {corner && <span className="absolute bottom-1.5 right-1.5">{corner}</span>}
        {score !== undefined && (
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-overlay">
            <span className={cn('block h-full origin-left', tone, dimmed && 'opacity-50')} style={{ transform: `scaleX(${Math.max(0.04, Math.min(1, score))})`, transition: 'transform var(--sc-duration-slow) var(--sc-ease-out)' }} />
          </span>
        )}
        {badge && <span className="absolute left-1 top-1">{badge}</span>}
        {marked && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-accent shadow-glow" />}
      </button>
    </Tooltip>
  );
}
