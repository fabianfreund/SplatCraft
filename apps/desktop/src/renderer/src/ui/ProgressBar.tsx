import { cn } from './cn';

export interface ProgressBarProps {
  /** 0..1; undefined = indeterminate. */
  value?: number;
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'neutral';
  height?: number;
  className?: string;
  active?: boolean;
}

const fill = { accent: 'bg-accent', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', neutral: 'bg-fg-subtle' } as const;

/** Fixed-size track; fill animates via transform so nothing reflows. */
export function ProgressBar({ value, tone = 'accent', height = 4, className, active }: ProgressBarProps) {
  const indeterminate = value === undefined;
  return (
    <div className={cn('relative w-full overflow-hidden rounded-full bg-surface-4', className)} style={{ height }} role="progressbar" aria-valuenow={value}>
      <div
        className={cn('absolute inset-y-0 left-0 w-full origin-left rounded-full transition-transform duration-300 ease-out', fill[tone])}
        style={{
          transform: `scaleX(${indeterminate ? 0.3 : Math.max(0, Math.min(1, value))})`,
          animation: indeterminate ? 'sc-pulse 1.2s var(--sc-ease-in-out) infinite' : undefined,
        }}
      />
      {active && !indeterminate && (
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: 'repeating-linear-gradient(-45deg, transparent 0 4px, var(--sc-line-strong) 4px 8px)',
            animation: 'sc-stripes 0.6s linear infinite',
            clipPath: `inset(0 ${100 - Math.max(0, Math.min(1, value ?? 0)) * 100}% 0 0)`,
          }}
        />
      )}
    </div>
  );
}
