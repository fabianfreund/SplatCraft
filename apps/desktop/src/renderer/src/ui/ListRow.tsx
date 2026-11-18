import { forwardRef, type MouseEvent, type ReactNode } from 'react';
import { cn } from './cn';

export interface ListRowProps {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  /** Greyed (e.g. missing on disk). */
  dimmed?: boolean;
  size?: 'sm' | 'md' | 'lg';
  onClick?: (e: MouseEvent) => void;
  onDoubleClick?: (e: MouseEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;
  className?: string;
  tabIndex?: number;
}

const heights = { sm: 'h-8', md: 'h-11', lg: 'h-[52px]' } as const;

/** Fixed-height list row; selection only changes colors. */
export const ListRow = forwardRef<HTMLDivElement, ListRowProps>(function ListRow(
  { leading, title, subtitle, trailing, selected, dimmed, size = 'md', onClick, onDoubleClick, onContextMenu, className, tabIndex },
  ref,
) {
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      tabIndex={tabIndex}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={cn(
        'group flex shrink-0 items-center gap-2.5 rounded-md px-2 outline-none transition-colors duration-100',
        heights[size],
        selected ? 'bg-accent-soft' : 'hover:bg-surface-3',
        dimmed && !selected && 'opacity-45',
        className,
      )}
    >
      {leading && <div className="flex shrink-0 items-center justify-center">{leading}</div>}
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <span className={cn('ellipsis font-medium', size === 'sm' ? 'text-xs' : 'text-sm', 'text-fg')}>{title}</span>
        {subtitle && <span className={cn('ellipsis text-xs', 'text-fg-subtle')}>{subtitle}</span>}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-1">{trailing}</div>}
    </div>
  );
});
