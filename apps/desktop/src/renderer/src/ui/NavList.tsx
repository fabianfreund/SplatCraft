import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';

export interface NavItem<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

/** Vertical navigation for settings-style dialogs. Fixed 28px rows. */
export function NavList<T extends string>({ value, items, onChange, ariaLabel }: { value: T; items: NavItem<T>[]; onChange: (v: T) => void; ariaLabel?: string }) {
  return (
    <nav aria-label={ariaLabel} className="flex flex-col gap-0.5">
      {items.map((it) => {
        const active = it.value === value;
        const Icon = it.icon;
        return (
          <button
            key={it.value}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => onChange(it.value)}
            className={cn(
              'press flex h-[var(--sc-control-h)] items-center gap-2 rounded-sm px-2.5 text-left text-sm outline-none',
              active ? 'bg-accent-soft font-medium text-fg' : 'text-fg-muted hover:bg-surface-3 hover:text-fg',
            )}
          >
            {Icon && <Icon size={14} className={active ? 'text-accent' : 'text-fg-subtle'} />}
            {it.label}
          </button>
        );
      })}
    </nav>
  );
}
