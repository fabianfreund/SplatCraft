import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { Tooltip } from './Tooltip';

/** Large rounded list button (Xcode welcome style). */
export function ActionButton({ icon: Icon, title, shortcut, onClick, disabled, tooltip }: { icon: LucideIcon; title: string; shortcut?: ReactNode; onClick?: () => void; disabled?: boolean; tooltip?: string }) {
  const btn = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'no-drag group flex h-12 w-full items-center gap-3 rounded-lg border border-line bg-surface-3 px-3 text-left outline-none shadow-[var(--sc-inset-highlight)] transition-colors duration-150',
        'hover:bg-surface-4 focus-visible:border-line-focus disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-faint',
      )}
    >
      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent transition-colors duration-150', disabled && 'bg-surface-3 text-fg-faint')}>
        <Icon size={15} strokeWidth={2} />
      </span>
      <span className={cn('flex-1 text-md font-medium', disabled ? 'text-fg-faint' : 'text-fg')}>{title}</span>
      {shortcut && <span className="flex items-center gap-0.5">{shortcut}</span>}
    </button>
  );
  return tooltip ? (
    <Tooltip content={tooltip} className="w-full" side="right">
      {btn}
    </Tooltip>
  ) : (
    btn
  );
}
