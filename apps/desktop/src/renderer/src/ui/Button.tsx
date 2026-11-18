import type { LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';
import { Spinner } from './Spinner';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
export type ButtonSize = 'sm' | 'md' | 'lg';

const variantCls: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-ink font-semibold shadow-[var(--sc-inset-highlight)] hover:bg-accent-strong active:brightness-95 disabled:bg-surface-4 disabled:text-fg-subtle',
  secondary: 'bg-surface-3 text-fg border border-line-strong hover:bg-surface-4 shadow-[var(--sc-inset-highlight)] disabled:text-fg-faint',
  ghost: 'text-fg-muted hover:text-fg hover:bg-surface-3 disabled:text-fg-faint',
  subtle: 'bg-surface-2 text-fg-muted border border-line hover:text-fg hover:bg-surface-3 disabled:text-fg-faint',
  danger: 'bg-danger-soft text-danger border border-danger-soft hover:bg-danger hover:text-accent-ink font-semibold',
};
// Borders are reserved on every variant (transparent where unused) so sizes never shift.
const sizeCls: Record<ButtonSize, string> = {
  sm: 'h-[var(--sc-control-h-sm)] px-2 gap-1.5 text-xs rounded-sm',
  md: 'h-[var(--sc-control-h)] px-3 gap-1.5 text-sm rounded-sm',
  lg: 'h-[var(--sc-control-h-lg)] px-4 gap-2 text-md rounded-md',
};
const iconSize: Record<ButtonSize, number> = { sm: 13, md: 14, lg: 16 };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  trailing?: ReactNode;
  loading?: boolean;
  /** Fixed min width so a changing label never resizes the button. */
  minWidth?: number;
  tooltip?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, trailing, loading, minWidth, tooltip, className, children, style, disabled, ...rest },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cn(
        'no-drag relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap border border-transparent font-medium outline-none',
        'transition-[background-color,color,box-shadow,filter] duration-150 ease-out disabled:cursor-not-allowed',
        variantCls[variant],
        sizeCls[size],
        className,
      )}
      style={{ minWidth, ...style }}
      {...rest}
    >
      <span className={cn('inline-flex items-center gap-[inherit]', loading && 'invisible')}>
        {Icon && <Icon size={iconSize[size]} strokeWidth={2} className="shrink-0" />}
        {children}
        {trailing}
      </span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size={iconSize[size]} />
        </span>
      )}
    </button>
  );
  return tooltip ? <Tooltip content={tooltip}>{btn}</Tooltip> : btn;
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  size?: 'xs' | 'sm' | 'md';
  variant?: 'ghost' | 'secondary';
  active?: boolean;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
}

const ibSize = { xs: 'size-5 rounded-xs', sm: 'size-6 rounded-sm', md: 'size-7 rounded-sm' } as const;
const ibIcon = { xs: 12, sm: 14, md: 15 } as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 'sm', variant = 'ghost', active, tooltipSide = 'top', className, ...rest },
  ref,
) {
  return (
    <Tooltip content={label} side={tooltipSide}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'no-drag inline-flex shrink-0 items-center justify-center border outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:text-fg-faint',
          ibSize[size],
          variant === 'secondary' ? 'border-line-strong bg-surface-3 hover:bg-surface-4' : 'border-transparent hover:bg-surface-3',
          active ? 'bg-accent-soft text-accent hover:bg-accent-soft' : 'text-fg-muted hover:text-fg',
          className,
        )}
        {...rest}
      >
        <Icon size={ibIcon[size]} strokeWidth={2} />
      </button>
    </Tooltip>
  );
});
