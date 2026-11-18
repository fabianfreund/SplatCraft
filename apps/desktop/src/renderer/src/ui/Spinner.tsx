import { cn } from './cn';

/** Fixed-box spinner; never changes its footprint. */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ animation: 'sc-spin 0.8s linear infinite' }}>
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.5" />
        <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}
