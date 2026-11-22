import { cn } from './cn';

export interface Chip<T extends string> {
  value: T;
  label: string;
  count?: number;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}

/** Filter chips with fixed-width counts (no shifting as numbers change). */
export function ChipGroup<T extends string>({ value, chips, onChange }: { value: T; chips: Chip<T>[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" className="no-drag flex items-center gap-1">
      {chips.map((c) => {
        const active = c.value === value;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(c.value)}
            className={cn(
              'press inline-flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium outline-none',
              active ? 'border-line-strong bg-surface-4 text-fg' : 'border-transparent text-fg-subtle hover:bg-surface-2 hover:text-fg-muted',
            )}
          >
            {c.tone && c.tone !== 'neutral' && <span className={cn('size-1.5 rounded-full', c.tone === 'success' ? 'bg-success' : c.tone === 'warning' ? 'bg-warning' : 'bg-danger')} />}
            {c.label}
            {c.count !== undefined && <span className="tnum min-w-[22px] text-right text-2xs text-fg-subtle">{c.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
