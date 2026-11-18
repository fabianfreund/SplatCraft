import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { HelpTip, Label } from '../../ui';

export interface Point {
  x: number;
  y: number;
}

export interface LineChartProps {
  title: string;
  help?: string;
  data: Point[];
  height?: number;
  /** Fixed y domain (e.g. 0–100 for percentages). */
  yMin?: number;
  yMax?: number;
  formatY?: (v: number) => string;
  formatX?: (v: number) => string;
  unit?: string;
  /** Value shown in the header; defaults to the last point. */
  headline?: string;
  tone?: 'accent' | 'warning' | 'danger';
  log?: boolean;
}

const PAD = { l: 40, r: 10, t: 8, b: 20 };
const stroke = { accent: 'var(--sc-chart-line)', warning: 'var(--sc-warning)', danger: 'var(--sc-danger)' } as const;

function niceTicks(lo: number, hi: number, n = 4): number[] {
  const span = hi - lo || 1;
  const raw = span / n;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/** Downsample to ≤ maxPts using min/max buckets (keeps spikes). */
function decimate(d: Point[], maxPts: number): Point[] {
  if (d.length <= maxPts) return d;
  const bucket = d.length / (maxPts / 2);
  const out: Point[] = [];
  for (let i = 0; i < d.length; i += bucket) {
    const slice = d.slice(Math.floor(i), Math.floor(i + bucket));
    if (!slice.length) continue;
    let mn = slice[0];
    let mx = slice[0];
    for (const p of slice) {
      if (p.y < mn.y) mn = p;
      if (p.y > mx.y) mx = p;
    }
    out.push(...(mn.x < mx.x ? [mn, mx] : [mx, mn]));
  }
  return out;
}

/**
 * Lightweight single-series SVG line chart with crosshair + tooltip.
 * Fixed height; width follows the container.
 */
export function LineChart({ title, help, data, height = 150, yMin, yMax, formatY = (v) => v.toFixed(2), formatX = (v) => String(Math.round(v)), unit, headline, tone = 'accent', log }: LineChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const innerW = Math.max(10, w - PAD.l - PAD.r);
  const innerH = height - PAD.t - PAD.b;
  const tf = (v: number) => (log ? Math.log10(Math.max(v, 1e-12)) : v);

  const model = useMemo(() => {
    const pts = decimate(data, Math.max(60, Math.floor(innerW)));
    if (!pts.length) return null;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => tf(p.y));
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    let y0 = yMin !== undefined ? tf(yMin) : Math.min(...ys);
    let y1 = yMax !== undefined ? tf(yMax) : Math.max(...ys);
    if (y0 === y1) {
      y0 -= 1;
      y1 += 1;
    }
    if (yMin === undefined || yMax === undefined) {
      const pad = (y1 - y0) * 0.08;
      if (yMin === undefined) y0 -= pad;
      if (yMax === undefined) y1 += pad;
    }
    const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0 || 1)) * innerW;
    const sy = (y: number) => PAD.t + innerH - ((tf(y) - y0) / (y1 - y0)) * innerH;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
    const area = `${d}L${sx(pts[pts.length - 1].x).toFixed(1)},${PAD.t + innerH}L${sx(pts[0].x).toFixed(1)},${PAD.t + innerH}Z`;
    const yTicks = log ? niceTicks(y0, y1, 3).map((t) => Math.pow(10, t)) : niceTicks(y0, y1, 3);
    const xTicks = niceTicks(x0, x1, Math.max(3, Math.floor(innerW / 80)));
    return { pts, sx, sy, d, area, yTicks, xTicks, x0, x1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, innerW, innerH, yMin, yMax, log]);

  const hp = hover !== null && model ? model.pts[hover] : null;
  const last = data[data.length - 1];

  const onMove = (e: ReactMouseEvent<SVGRectElement>) => {
    if (!model) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left + PAD.l;
    let best = 0;
    let bd = Infinity;
    model.pts.forEach((p, i) => {
      const dd = Math.abs(model.sx(p.x) - px);
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    });
    setHover(best);
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line bg-surface-1 p-3">
      <div className="flex h-5 items-center gap-1.5">
        <Label>{title}</Label>
        <HelpTip text={help} />
        <span className="tnum ml-auto min-w-[64px] text-right text-sm font-semibold text-fg">
          {hp ? formatY(hp.y) : (headline ?? (last ? formatY(last.y) : '—'))}
          {unit && <span className="ml-0.5 text-2xs font-normal text-fg-subtle">{unit}</span>}
        </span>
      </div>
      <div ref={ref} className="relative w-full" style={{ height }}>
        <svg width={w} height={height} className="absolute inset-0 block">
          {model?.yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={PAD.l} x2={PAD.l + innerW} y1={model.sy(t)} y2={model.sy(t)} stroke="var(--sc-chart-grid)" />
              <text x={PAD.l - 6} y={model.sy(t)} dy="0.32em" textAnchor="end" fontSize="10" fill="var(--sc-chart-axis)" className="tnum">
                {formatY(t)}
              </text>
            </g>
          ))}
          {model?.xTicks.map((t) => (
            <text key={`x${t}`} x={model.sx(t)} y={height - 5} textAnchor="middle" fontSize="10" fill="var(--sc-chart-axis)" className="tnum">
              {formatX(t)}
            </text>
          ))}
          {model && (
            <>
              <path d={model.area} fill={tone === 'accent' ? 'var(--sc-chart-fill)' : stroke[tone]} opacity={tone === 'accent' ? 1 : 0.08} />
              <path d={model.d} fill="none" stroke={stroke[tone]} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
            </>
          )}
          {hp && model && (
            <g pointerEvents="none">
              <line x1={model.sx(hp.x)} x2={model.sx(hp.x)} y1={PAD.t} y2={PAD.t + innerH} stroke="var(--sc-chart-crosshair)" />
              <circle cx={model.sx(hp.x)} cy={model.sy(hp.y)} r={4} fill={stroke[tone]} stroke="var(--sc-surface-1)" strokeWidth={2} />
            </g>
          )}
          <rect x={PAD.l} y={PAD.t} width={innerW} height={innerH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>
        {hp && model && (
          <div
            className="tnum pointer-events-none absolute z-10 rounded-sm border border-line-strong bg-surface-4 px-2 py-1 text-2xs text-fg-muted shadow-md"
            style={{
              left: Math.min(model.sx(hp.x) + 8, w - 110),
              top: 4,
            }}
          >
            <span className="text-fg">{formatY(hp.y)}</span>
            {unit && ` ${unit}`} · {formatX(hp.x)}
          </div>
        )}
        {!model && <div className="absolute inset-0 flex items-center justify-center text-xs text-fg-faint">—</div>}
      </div>
    </div>
  );
}
