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
        'group/sw no-drag relative inline-flex shrink-0 items-center rounded-full border outline-none transition-colors duration-200 disabled:opacity-40',
        checked ? 'border-transparent bg-accent' : 'border-line-strong bg-surface-4',
      )}
      style={{ width: w, height: h }}
    >
      {/* Knob springs across; while pressed it stretches toward the travel direction. */}
      <span
        className={cn(
          'absolute rounded-full shadow-sm group-active/sw:w-[calc(var(--k)+5px)]',
          checked ? 'bg-accent-ink group-active/sw:[margin-left:-5px]' : 'bg-fg-muted',
        )}
        style={
          {
            '--k': `${k}px`,
            width: k,
            height: k,
            left: 1,
            transform: `translateX(${checked ? w - k - 4 : 0}px)`,
            transition: 'transform var(--sc-duration-spring) var(--sc-ease-spring), width var(--sc-duration-fast) ease-out, margin var(--sc-duration-fast) ease-out, background-color var(--sc-duration-fast) ease-out',
          } as React.CSSProperties
        }
      />
    </button>
  );
}
