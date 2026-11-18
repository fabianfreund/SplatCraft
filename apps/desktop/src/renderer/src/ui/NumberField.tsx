import { useEffect, useState } from 'react';
import { cn } from './cn';

export interface NumberFieldProps {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  changed?: boolean;
  /** Fixed width in px (numbers never resize their box). */
  width?: number;
  suffix?: string;
  className?: string;
}

/** Text-entry number with commit on blur/Enter and ↑/↓ stepping. */
export function NumberField({ value, onChange, placeholder, min, max, step, integer, changed, width = 76, suffix, className }: NumberFieldProps) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  useEffect(() => setDraft(value === undefined ? '' : String(value)), [value]);

  const clamp = (n: number) => {
    let v = integer ? Math.round(n) : n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  };
  const commit = (raw: string) => {
    if (raw.trim() === '') return onChange(undefined);
    const n = Number(raw);
    if (Number.isFinite(n)) onChange(clamp(n));
    else setDraft(value === undefined ? '' : String(value));
  };
  const s = step ?? (integer ? 1 : 0.1);

  return (
    <div
      className={cn(
        'no-drag relative flex h-[var(--sc-control-h-sm)] shrink-0 items-center rounded-sm border bg-surface-1 transition-[border-color] duration-150 focus-within:border-line-focus',
        changed ? 'border-accent-soft bg-accent-softer' : 'border-line-strong',
        className,
      )}
      style={{ width }}
    >
      <input
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const base = draft === '' ? Number(placeholder ?? 0) || 0 : Number(draft);
            const mult = e.shiftKey ? 10 : 1;
            const next = clamp(+(base + (e.key === 'ArrowUp' ? s : -s) * mult).toFixed(6));
            onChange(next);
          }
        }}
        className={cn(
          'tnum h-full w-full min-w-0 bg-transparent px-1.5 text-right text-xs outline-none placeholder:text-fg-faint',
          changed ? 'text-accent-strong' : 'text-fg',
        )}
      />
      {suffix && <span className="pr-1.5 text-2xs text-fg-subtle">{suffix}</span>}
    </div>
  );
}
