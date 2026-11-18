import { X } from 'lucide-react';
import { forwardRef, useState, type InputHTMLAttributes, type KeyboardEvent, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

const fieldBase =
  'no-drag w-full min-w-0 rounded-sm border border-line-strong bg-surface-1 text-sm text-fg placeholder:text-fg-faint outline-none transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus:border-line-focus focus:shadow-[0_0_0_3px_var(--sc-accent-softer)] disabled:text-fg-subtle';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  /** Visually highlight as a user override. */
  changed?: boolean;
  ghost?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ size = 'md', changed, ghost, className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      spellCheck={false}
      className={cn(
        fieldBase,
        size === 'sm' && 'h-[var(--sc-control-h-sm)] px-2 text-xs',
        size === 'md' && 'h-[var(--sc-control-h)] px-2.5',
        size === 'lg' && 'h-[var(--sc-control-h-lg)] rounded-md px-3 text-md',
        changed && 'border-accent-soft bg-accent-softer text-accent-strong',
        ghost && 'border-transparent bg-transparent hover:border-line-strong',
        className,
      )}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, 'resize-none px-2.5 py-1.5 leading-[18px]', className)} {...rest} />;
});

export interface TagInputProps {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  size?: 'sm' | 'md';
}

/** Chips + free text; Enter/comma adds, Backspace on empty removes. */
export function TagInput({ value, onChange, placeholder, size = 'md' }: TagInputProps) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const parts = draft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !value.includes(s));
    if (parts.length) onChange([...value, ...parts]);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div
      className={cn(
        fieldBase,
        'flex flex-wrap items-center gap-1 px-1.5 py-[3px] focus-within:border-line-focus focus-within:shadow-[0_0_0_3px_var(--sc-accent-softer)]',
        size === 'sm' ? 'min-h-[var(--sc-control-h-sm)]' : 'min-h-[var(--sc-control-h)]',
      )}
    >
      {value.map((t) => (
        <span key={t} className="inline-flex h-5 items-center gap-0.5 rounded-xs bg-surface-3 pl-1.5 pr-0.5 text-xs text-fg-muted">
          {t}
          <button
            type="button"
            aria-label={`Remove ${t}`}
            className="inline-flex size-4 items-center justify-center rounded-xs text-fg-subtle hover:bg-surface-4 hover:text-fg"
            onClick={() => onChange(value.filter((x) => x !== t))}
          >
            <X size={10} strokeWidth={2.5} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
        placeholder={value.length ? '' : placeholder}
        className="h-5 min-w-[60px] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-fg-faint"
      />
    </div>
  );
}
