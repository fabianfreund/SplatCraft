import type { ReactNode } from 'react';

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-line-strong bg-surface-3 px-1 font-sans text-2xs text-fg-muted">
      {children}
    </kbd>
  );
}
