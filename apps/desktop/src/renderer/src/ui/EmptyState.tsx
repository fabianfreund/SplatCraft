import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

/** Icon + short title + optional action. No sentences. */
export function EmptyState({ icon: Icon, title, action, className, size = 'md' }: { icon: LucideIcon; title: string; action?: ReactNode; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-16 rounded-xl' : size === 'md' ? 'size-11 rounded-lg' : 'size-8 rounded-md';
  const ic = size === 'lg' ? 28 : size === 'md' ? 20 : 15;
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 text-center', className)}>
      <div className={cn('flex items-center justify-center border border-line-strong bg-surface-2 text-fg-subtle shadow-[var(--sc-inset-highlight)]', box)}>
        <Icon size={ic} strokeWidth={1.75} />
      </div>
      <span className={cn('font-medium text-fg-muted', size === 'lg' ? 'text-lg' : 'text-sm')}>{title}</span>
      {action}
    </div>
  );
}
