import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './Button';
import { cn } from './cn';
import { HelpTip } from './Tooltip';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  help?: string;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
  /** 'sheet' = macOS-style sheet attached to the top; 'dialog' = centered. */
  variant?: 'dialog' | 'sheet';
  height?: number | string;
}

export function Dialog({ open, onClose, title, help, width = 520, children, footer, variant = 'dialog', height }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const sheet = variant === 'sheet';
  return createPortal(
    <div
      className={cn('no-drag fixed inset-0 z-[900] flex justify-center bg-overlay', sheet ? 'items-start pt-[var(--sc-topbar-h)]' : 'items-center')}
      style={{ animation: 'sc-fade-in var(--sc-duration-base) var(--sc-ease-out)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal
        className={cn('flex max-h-[calc(100vh-80px)] flex-col overflow-hidden border border-line-strong bg-surface-2 shadow-lg', sheet ? 'rounded-b-xl rounded-t-md' : 'rounded-xl')}
        style={{ width, height, animation: `${sheet ? 'sc-sheet-in' : 'sc-pop-spring'} var(--sc-duration-spring) var(--sc-ease-spring)` }}
      >
        {title && (
          <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-line px-4">
            <span className="text-md font-semibold text-fg">{title}</span>
            <HelpTip text={help} />
            <div className="ml-auto">
              <IconButton icon={X} label="Close" onClick={onClose} />
            </div>
          </header>
        )}
        <div className="scroll-stable min-h-0 flex-1">{children}</div>
        {footer && <footer className="flex h-14 shrink-0 items-center justify-end gap-2 border-t border-line bg-surface-1 px-4">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Sheet(props: Omit<DialogProps, 'variant'>) {
  return <Dialog {...props} variant="sheet" />;
}
