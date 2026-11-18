import { ChevronsUpDown } from 'lucide-react';
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
}

/** Native select (OS popup) with app styling. */
export function Select<T extends string>({ value, options, onChange, placeholder, size = 'sm', changed, className, width }: SelectProps<T>) {
  return (
    <div className={cn('no-drag relative inline-flex shrink-0', className)} style={{ width }}>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value as T)}
        className={cn(
          'w-full appearance-none rounded-sm border bg-surface-1 pl-2 pr-6 outline-none transition-[border-color] duration-150 focus:border-line-focus',
          size === 'sm' ? 'h-[var(--sc-control-h-sm)] text-xs' : 'h-[var(--sc-control-h)] text-sm',
          changed ? 'border-accent-soft bg-accent-softer text-accent-strong' : 'border-line-strong text-fg',
        )}
      >
        {value === undefined && <option value="">{placeholder ?? '—'}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronsUpDown size={12} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
    </div>
  );
}
