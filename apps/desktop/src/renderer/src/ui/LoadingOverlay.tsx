import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { ProgressBar } from './ProgressBar';

export interface LoadingOverlayProps {
  show: boolean;
  label?: string;
  /** 0–1; omit for indeterminate. */
  progress?: number;
  /** 'local' covers the nearest positioned parent; 'app' covers the window. */
  scope?: 'local' | 'app';
  /** Only appear if loading takes longer than this (no flash for fast loads). */
  delay?: number;
}

const MIN_VISIBLE = 350;

/**
 * Blurs what's behind it and shows a calm glass card with a spinner. The
 * spinner and the fade are compositor-only (transform/opacity), so they keep
 * moving even while the main thread or GPU is busy loading.
 */
export function LoadingOverlay({ show, label, progress, scope = 'local', delay = 150 }: LoadingOverlayProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    let t: number | undefined;
    if (show) {
      t = window.setTimeout(() => {
        shownAt.current = performance.now();
        setMounted(true);
        requestAnimationFrame(() => setVisible(true));
      }, delay);
    } else if (mounted) {
      const wait = Math.max(0, MIN_VISIBLE - (performance.now() - shownAt.current));
      t = window.setTimeout(() => {
        setVisible(false);
        t = window.setTimeout(() => setMounted(false), 240);
      }, wait);
    }
    return () => clearTimeout(t);
  }, [show, delay, mounted]);

  if (!mounted) return null;
  const node = (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'no-drag inset-0 z-[960] flex items-center justify-center bg-overlay transition-opacity duration-200 ease-out',
        scope === 'app' ? 'fixed' : 'absolute',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      style={{ WebkitBackdropFilter: 'blur(10px) saturate(1.2)', backdropFilter: 'blur(10px) saturate(1.2)' }}
    >
      <div
        className="glass flex min-w-[200px] flex-col items-center gap-3 rounded-xl border px-6 py-5"
        style={{ transform: visible ? 'none' : 'translateY(6px) scale(0.96)', transition: 'transform var(--sc-duration-spring) var(--sc-ease-spring)' }}
      >
        <Ring />
        {label && <span className="text-sm font-medium text-fg">{label}</span>}
        {progress !== undefined && (
          <div className="w-40">
            <ProgressBar value={progress} height={3} />
          </div>
        )}
      </div>
    </div>
  );
  return scope === 'app' ? createPortal(node, document.body) : node;
}

/** Two-tone arc that rotates on the compositor. */
function Ring() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden style={{ animation: 'sc-spin 0.9s linear infinite' }}>
      <circle cx="14" cy="14" r="11" fill="none" stroke="var(--sc-line-strong)" strokeWidth="2.5" />
      <circle cx="14" cy="14" r="11" fill="none" stroke="var(--sc-accent)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="22 70" />
    </svg>
  );
}
