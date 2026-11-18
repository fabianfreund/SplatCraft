import { cn } from './cn';

export interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  size?: 'sm' | 'md';
  label?: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, size = 'md', label, disabled }: SwitchProps) {
  const w = size === 'sm' ? 24 : 30;
  const h = size === 'sm' ? 14 : 17;
  const k = h - 4;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        'no-drag relative inline-flex shrink-0 items-center rounded-full border outline-none transition-colors duration-200 disabled:opacity-40',
        checked ? 'border-transparent bg-accent' : 'border-line-strong bg-surface-4',
      )}
      style={{ width: w, height: h }}
    >
      <span
        className={cn('absolute rounded-full shadow-sm transition-transform duration-200 ease-out', checked ? 'bg-accent-ink' : 'bg-fg-muted')}
        style={{ width: k, height: k, left: 1, transform: `translateX(${checked ? w - k - 4 : 0}px)` }}
      />
    </button>
  );
}
