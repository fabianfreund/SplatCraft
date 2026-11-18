import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { HelpTip } from './Tooltip';

/** Selectable card (e.g. preset picker). Border width never changes. */
export function ChoiceCard({ icon: Icon, title, meta, help, selected, onSelect }: { icon: LucideIcon; title: string; meta?: string; help?: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'relative flex h-[88px] flex-1 flex-col items-start justify-between rounded-lg border p-3 text-left outline-none transition-[background-color,border-color,box-shadow] duration-150',
        selected ? 'border-accent bg-accent-softer shadow-glow' : 'border-line-strong bg-surface-1 hover:bg-surface-3',
      )}
    >
      <span className={cn('flex size-7 items-center justify-center rounded-md', selected ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-fg-muted')}>
        <Icon size={15} strokeWidth={2} />
      </span>
      <span className="flex w-full items-center gap-1">
        <span className="text-sm font-semibold text-fg">{title}</span>
        {meta && <span className="tnum ml-auto text-2xs text-fg-subtle">{meta}</span>}
      </span>
      {help && (
        <span className="absolute right-2 top-2">
          <HelpTip text={help} />
        </span>
      )}
    </button>
  );
}
