import { CircleX, X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/** Error toast in an overlay (never shifts layout). */
export function Toast({ message, onClose, timeout = 6000 }: { message?: string; onClose: () => void; timeout?: number }) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onClose, timeout);
    return () => clearTimeout(id);
  }, [message, onClose, timeout]);
  if (!message) return null;
  return createPortal(
    <div
      role="alert"
      className="no-drag fixed bottom-12 left-1/2 z-[1200] flex max-w-[520px] -translate-x-1/2 items-center gap-2 rounded-md border border-danger-soft bg-surface-3 py-2 pl-3 pr-1.5 text-sm text-fg shadow-lg"
      style={{ animation: 'sc-pop-in var(--sc-duration-base) var(--sc-ease-out)' }}
    >
      <CircleX size={15} className="shrink-0 text-danger" />
      <span className="min-w-0 flex-1 break-words">{message}</span>
      <button type="button" aria-label="Dismiss" onClick={onClose} className="flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-subtle hover:bg-surface-4 hover:text-fg">
        <X size={13} />
      </button>
    </div>,
    document.body,
  );
}
