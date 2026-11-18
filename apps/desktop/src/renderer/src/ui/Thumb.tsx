import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from './cn';

/** Fixed-size thumbnail: image when available, icon tile otherwise. */
export function Thumb({ src, icon: Icon, size = 32, selected, className }: { src?: string; icon: LucideIcon; size?: number; selected?: boolean; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-md border',
        selected ? 'border-accent-ink/20 bg-accent-ink/15 text-accent-ink' : 'border-line-strong bg-surface-3 text-accent',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src && !failed ? (
        <img src={src} alt="" className="size-full object-cover" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <Icon size={Math.round(size * 0.48)} strokeWidth={1.75} />
      )}
    </span>
  );
}
