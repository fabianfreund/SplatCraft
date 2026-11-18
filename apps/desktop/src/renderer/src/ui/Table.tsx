import type { ReactNode } from 'react';
import { cn } from './cn';

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <table className={cn('w-full table-fixed border-separate border-spacing-0 text-sm', className)}>{children}</table>;
}

export function Th({ children, width, align = 'left' }: { children?: ReactNode; width?: number | string; align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      className="sticky top-0 z-[1] h-8 border-b border-line bg-surface-1 px-3 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-subtle"
      style={{ width, textAlign: align }}
    >
      {children}
    </th>
  );
}

export function Tr({ children, selected, onClick }: { children: ReactNode; selected?: boolean; onClick?: () => void }) {
  return (
    <tr onClick={onClick} className={cn('h-10 transition-colors duration-100', onClick && 'cursor-pointer', selected ? 'bg-accent-softer' : 'hover:bg-surface-2')}>
      {children}
    </tr>
  );
}

export function Td({ children, align = 'left', mono, muted, className }: { children?: ReactNode; align?: 'left' | 'right' | 'center'; mono?: boolean; muted?: boolean; className?: string }) {
  return (
    <td className={cn('ellipsis border-b border-line px-3', mono && 'font-mono text-xs', muted ? 'text-fg-subtle' : 'text-fg', className)} style={{ textAlign: align }}>
      {children}
    </td>
  );
}
