import type { ElementType, ReactNode } from 'react';
import { cn } from './cn';

const sizes = {
  '2xs': 'text-2xs',
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-md',
  lg: 'text-lg',
  xl: 'text-xl font-display',
  '2xl': 'text-2xl font-display',
  '3xl': 'text-3xl font-display',
} as const;
const tones = {
  default: 'text-fg',
  muted: 'text-fg-muted',
  subtle: 'text-fg-subtle',
  faint: 'text-fg-faint',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
  inherit: '',
} as const;
const weights = { regular: 'font-normal', medium: 'font-medium', semibold: 'font-semibold', bold: 'font-bold' } as const;

export type TextTone = keyof typeof tones;

export interface TextProps {
  as?: ElementType;
  size?: keyof typeof sizes;
  tone?: TextTone;
  weight?: keyof typeof weights;
  mono?: boolean;
  /** Tabular numbers. */
  num?: boolean;
  truncate?: boolean;
  upper?: boolean;
  className?: string;
  title?: string;
  children?: ReactNode;
}

export function Text({ as: As = 'span', size = 'sm', tone = 'default', weight = 'regular', mono, num, truncate, upper, className, title, children }: TextProps) {
  return (
    <As
      title={title}
      className={cn(
        sizes[size],
        tones[tone],
        weights[weight],
        mono && 'font-mono',
        num && 'tnum',
        truncate && 'ellipsis min-w-0',
        upper && 'uppercase tracking-[0.06em]',
        className,
      )}
    >
      {children}
    </As>
  );
}

/** Small uppercase label used for section headers and stat captions. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Text size="2xs" tone="subtle" weight="semibold" upper className={className}>
      {children}
    </Text>
  );
}
