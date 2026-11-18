import { ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from './cn';
import { Label } from './Text';
import { HelpTip } from './Tooltip';

export function Panel({ children, className, as: As = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'aside' | 'section' | 'main' }) {
  return <As className={cn('flex min-h-0 min-w-0 flex-col bg-surface-1', className)}>{children}</As>;
}

export interface SectionProps {
  title: string;
  help?: string;
  actions?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
  bodyClassName?: string;
  count?: ReactNode;
}

/** Titled block with a fixed-height header. */
export function Section({ title, help, actions, children, collapsible, defaultOpen = true, className, bodyClassName, count }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={cn('flex min-h-0 flex-col', className)}>
      <header className="flex h-8 shrink-0 items-center gap-1.5 px-3">
        {collapsible ? (
          <button type="button" onClick={() => setOpen(!open)} className="-ml-1 flex items-center gap-1 rounded-xs pr-1 outline-none">
            <ChevronRight size={12} className={cn('text-fg-subtle transition-transform duration-150', open && 'rotate-90')} />
            <Label>{title}</Label>
          </button>
        ) : (
          <Label>{title}</Label>
        )}
        {count !== undefined && <span className="tnum text-2xs text-fg-faint">{count}</span>}
        <HelpTip text={help} />
        <div className="ml-auto flex items-center gap-0.5">{actions}</div>
      </header>
      {open && <div className={cn('min-h-0', bodyClassName)}>{children}</div>}
    </section>
  );
}

/** Label + control row used by forms. */
export function Field({ label, help, children, trailing, className, stacked }: { label: string; help?: string; children: ReactNode; trailing?: ReactNode; className?: string; stacked?: boolean }) {
  return (
    <div className={cn(stacked ? 'flex flex-col gap-1.5' : 'flex min-h-[var(--sc-control-h)] items-center gap-2', className)}>
      <div className={cn('flex shrink-0 items-center gap-1', !stacked && 'w-[42%] min-w-0')}>
        <span className="ellipsis text-xs text-fg-muted">{label}</span>
        <HelpTip text={help} />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
      {trailing && <div className="flex w-5 shrink-0 items-center justify-center">{trailing}</div>}
    </div>
  );
}

/** Caption + tabular value with a reserved width. */
export function Stat({ label, value, unit, minWidth = 48, tone }: { label: string; value: ReactNode; unit?: string; minWidth?: number; tone?: 'default' | 'warning' | 'danger' | 'accent' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Label>{label}</Label>
      <span
        className={cn(
          'tnum text-sm font-medium',
          tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : tone === 'accent' ? 'text-accent' : 'text-fg',
        )}
        style={{ minWidth }}
      >
        {value}
        {unit && <span className="ml-0.5 text-2xs font-normal text-fg-subtle">{unit}</span>}
      </span>
    </div>
  );
}
