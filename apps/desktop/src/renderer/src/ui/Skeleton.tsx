import { cn } from './cn';

/** Placeholder occupying the final dimensions of loading content. */
export function Skeleton({ className, width, height }: { className?: string; width?: number | string; height?: number | string }) {
  return (
    <div
      className={cn('rounded-sm bg-surface-3', className)}
      style={{
        width,
        height,
        backgroundImage: 'linear-gradient(90deg, transparent, var(--sc-line), transparent)',
        backgroundSize: '200px 100%',
        backgroundRepeat: 'no-repeat',
        animation: 'sc-shimmer 1.4s var(--sc-ease-in-out) infinite',
      }}
    />
  );
}
