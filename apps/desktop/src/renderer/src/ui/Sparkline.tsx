import { useMemo } from 'react';

export interface SparklineProps {
  values: (number | undefined)[];
  width?: number;
  height?: number;
  min?: number;
  max?: number;
  tone?: 'accent' | 'warning' | 'danger' | 'muted';
}

const stroke = { accent: 'var(--sc-accent)', warning: 'var(--sc-warning)', danger: 'var(--sc-danger)', muted: 'var(--sc-fg-subtle)' } as const;

/** Tiny fixed-size trend line (no axes, no interaction). */
export function Sparkline({ values, width = 56, height = 16, min, max, tone = 'accent' }: SparklineProps) {
  const { line, area } = useMemo(() => {
    const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== undefined && Number.isFinite(p[1]));
    if (pts.length < 2) return { line: '', area: '' };
    const lo = min ?? Math.min(...pts.map((p) => p[1]));
    const hi = max ?? Math.max(...pts.map((p) => p[1]));
    const span = hi - lo || 1;
    const n = Math.max(values.length - 1, 1);
    const xy = pts.map(([i, v]) => [(i / n) * width, height - 1 - ((v - lo) / span) * (height - 2)] as const);
    const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
    const area = `${line}L${xy[xy.length - 1][0].toFixed(1)},${height}L${xy[0][0].toFixed(1)},${height}Z`;
    return { line, area };
  }, [values, width, height, min, max]);
  return (
    <svg width={width} height={height} className="shrink-0 overflow-visible" aria-hidden>
      {area && <path d={area} fill={stroke[tone]} opacity={0.12} />}
      {line && <path d={line} fill="none" stroke={stroke[tone]} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />}
    </svg>
  );
}
