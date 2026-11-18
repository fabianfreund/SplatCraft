import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  badge?: ReactNode;
}

export interface TabsProps<T extends string> {
  value: T;
  items: TabItem<T>[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}

/** Underline tabs. Labels never change weight on select (no width shift). */
export function Tabs<T extends string>({ value, items, onChange, size = 'md' }: TabsProps<T>) {
  return (
    <div role="tablist" className="no-drag flex h-full items-stretch gap-0.5">
      {items.map((it) => {
        const active = it.value === value;
        const Icon = it.icon;
        return (
          <button
            key={it.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              'relative inline-flex items-center gap-1.5 rounded-sm px-2.5 font-medium outline-none transition-colors duration-150',
              size === 'sm' ? 'text-xs' : 'text-sm',
              active ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
            )}
          >
            {Icon && <Icon size={14} strokeWidth={2} />}
            {it.label}
            {it.badge}
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-accent transition-opacity duration-200',
                active ? 'opacity-100' : 'opacity-0',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
