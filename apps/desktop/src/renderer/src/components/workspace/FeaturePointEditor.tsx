import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { usePipeline } from '../../store/pipeline';
import { currentTracks, useTiePoints } from '../../store/tiepoints';
import { cn, IconButton, Tooltip } from '../../ui';

const LOUPE = 132;
/** Loupe magnification at fit size; it shrinks (to at least LOUPE_MIN) as the view zooms in. */
const LOUPE_ZOOM = 4;
const LOUPE_MIN = 2;
const MAX_ZOOM = 12;
const DRAG_PX = 3;

interface Props {
  /** Frame file name (the key points are stored under). */
  image: string;
  src: string;
  /** URL of another frame, for the reference crop. */
  frameUrl(name: string): string | undefined;
}

type Rect = { left: number; top: number; width: number; height: number };
type Pt = { x: number; y: number };

/**
 * Click the same spot in several frames: each click places the selected point in this
 * frame (or starts a new one). Drag a marker to move it, right-click to remove it.
 * Wheel zooms around the cursor, dragging empty space pans, 0 / double-click fits.
 * A loupe centered on the cursor magnifies the area under it; a crop shows the
 * selected point in another frame.
 */
export function FeaturePointEditor({ image, src, frameUrl }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number }>();
  const [fit, setFit] = useState<Rect>();
  /** Zoom factor over the fitted size, and the zoomed image's top-left in stage px. */
  const [zoom, setZoom] = useState<{ z: number; left: number; top: number }>({ z: 1, left: 0, top: 0 });
  const [hover, setHover] = useState<Pt>();
  const [drag, setDrag] = useState<{ id: number; x: number; y: number; moved: boolean }>();
  const [panning, setPanning] = useState(false);
  const pan = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | undefined>(undefined);
  const spec = usePipeline((s) => s.spec);
  const stages = usePipeline((s) => s.stages);
  const tracks = useMemo(() => currentTracks(spec, stages), [spec, stages]);
  const selected = useTiePoints((s) => s.track);
  const tp = useTiePoints;

  // Fit the image (object-contain); zoom 1 shows exactly that box.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el || !natural) return;
    const update = () => {
      const s = Math.min(el.clientWidth / natural.w, el.clientHeight / natural.h);
      const width = natural.w * s;
      const height = natural.h * s;
      const r = { left: (el.clientWidth - width) / 2, top: (el.clientHeight - height) / 2, width, height };
      setFit(r);
      setZoom({ z: 1, left: r.left, top: r.top });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [natural]);

  /** The image's current box in stage px. */
  const view: Rect | undefined = fit && { left: zoom.left, top: zoom.top, width: fit.width * zoom.z, height: fit.height * zoom.z };

  /** Keeps the image covering the stage when larger than it, centered when smaller. */
  const clampView = (f: Rect, z: number, left: number, top: number) => {
    const el = stage.current!;
    const w = f.width * z;
    const h = f.height * z;
    return {
      z,
      left: w <= el.clientWidth ? (el.clientWidth - w) / 2 : Math.min(0, Math.max(el.clientWidth - w, left)),
      top: h <= el.clientHeight ? (el.clientHeight - h) / 2 : Math.min(0, Math.max(el.clientHeight - h, top)),
    };
  };
  const resetView = () => fit && setZoom({ z: 1, left: fit.left, top: fit.top });

  // Wheel zoom around the cursor (non-passive so nothing else scrolls).
  useEffect(() => {
    const el = stage.current;
    if (!el || !fit) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      setZoom((cur) => {
        // Trackpad pinch arrives as ctrl+wheel with small deltas.
        const z = Math.min(MAX_ZOOM, Math.max(1, cur.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))));
        // Keep the image point under the cursor where it is.
        const fx = (cx - cur.left) / (fit.width * cur.z);
        const fy = (cy - cur.top) / (fit.height * cur.z);
        return clampView(fit, z, cx - fx * fit.width * z, cy - fy * fit.height * z);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [fit]);

  // N: new point · Delete: remove the selected point from this frame · 0: fit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)))) return;
      const { track, selectTrack, remove } = tp.getState();
      if (e.key === 'n' || e.key === 'N') selectTrack(undefined);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && track !== undefined) remove(track, image);
      else if (e.key === '0') resetView();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = stage.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const frac = (e: { clientX: number; clientY: number }): Pt => {
    const p = local(e);
    return { x: (p.x - view!.left) / view!.width, y: (p.y - view!.top) / view!.height };
  };
  const inside = (p: Pt) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

  const onStageDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || !view) return;
    const p = local(e);
    pan.current = { x: p.x, y: p.y, left: zoom.left, top: zoom.top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onStageMove = (e: ReactPointerEvent) => {
    if (!view || !fit) return;
    // Panning: a drag that started on empty space.
    if (pan.current) {
      const l = local(e);
      const dx = l.x - pan.current.x;
      const dy = l.y - pan.current.y;
      if (pan.current.moved || Math.hypot(dx, dy) > DRAG_PX) {
        if (!pan.current.moved) setPanning(true);
        pan.current.moved = true;
        setZoom(clampView(fit, zoom.z, pan.current.left + dx, pan.current.top + dy));
        setHover(undefined);
        return;
      }
    }
    const p = frac(e);
    setHover(inside(p) ? p : undefined);
    // A marker drag starts once the pointer leaves its start position by a few pixels.
    if (drag && (drag.moved || Math.hypot((p.x - drag.x) * view.width, (p.y - drag.y) * view.height) > DRAG_PX)) {
      setDrag({ id: drag.id, x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)), moved: true });
    }
  };
  const onStageUp = (e: ReactPointerEvent) => {
    if (!view || e.button !== 0) return;
    const panned = !!pan.current?.moved;
    pan.current = undefined;
    setPanning(false);
    if (drag) {
      if (drag.moved) tp.getState().move(drag.id, image, drag.x, drag.y);
      setDrag(undefined);
      return;
    }
    if (panned) return;
    const p = frac(e);
    if (inside(p)) tp.getState().click(image, p.x, p.y);
  };

  // Over the point bar or the reference crop (and a margin around the bar): no loupe, no clicks into the image.
  const controlZone = {
    onPointerDown: (e: ReactPointerEvent) => e.stopPropagation(),
    onPointerMove: (e: ReactPointerEvent) => {
      e.stopPropagation();
      setHover(undefined);
    },
    onPointerUp: (e: ReactPointerEvent) => e.stopPropagation(),
    onDoubleClick: (e: ReactMouseEvent) => e.stopPropagation(),
  };

  const here = tracks.flatMap((t) => t.points.filter((p) => p.image === image).map((p) => ({ id: t.id, x: p.x, y: p.y })));
  const sel = tracks.find((t) => t.id === selected);
  const ref = sel ? [...sel.points].reverse().find((p) => p.image !== image) : undefined;
  const refUrl = ref ? frameUrl(ref.image) : undefined;
  const aspect = natural ? natural.h / natural.w : 2 / 3;
  const loupeScale = Math.max(LOUPE_MIN, LOUPE_ZOOM / zoom.z);
  const at = (m: { id: number; x: number; y: number }): Pt => (drag?.moved && drag.id === m.id ? drag : m);

  return (
    <div
      ref={stage}
      className={cn('relative size-full touch-none select-none overflow-hidden', panning ? 'cursor-grabbing' : hover && !drag ? 'cursor-none' : 'cursor-crosshair')}
      onPointerDown={onStageDown}
      onPointerMove={onStageMove}
      onPointerUp={onStageUp}
      onPointerLeave={() => setHover(undefined)}
      onDoubleClick={resetView}
      onContextMenu={(e) => e.preventDefault()}
    >
      <img
        src={src}
        alt={image}
        draggable={false}
        onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        className="pointer-events-none absolute max-w-none"
        style={view ? { left: view.left, top: view.top, width: view.width, height: view.height } : { inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
      />
      {view &&
        here.map((m) => {
          const pos = at(m);
          const active = m.id === selected;
          return (
            <span
              key={m.id}
              role="button"
              aria-label={`Point ${m.id}`}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                stage.current?.setPointerCapture(e.pointerId);
                tp.getState().selectTrack(m.id);
                setDrag({ id: m.id, x: m.x, y: m.y, moved: false });
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                tp.getState().remove(m.id, image);
              }}
              className={cn(
                'tnum absolute flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full text-2xs font-semibold shadow-md',
                active ? 'z-10 bg-accent text-accent-ink ring-2 ring-bg' : 'bg-surface-4 text-fg ring-1 ring-line-strong',
              )}
              style={{ left: view.left + pos.x * view.width, top: view.top + pos.y * view.height }}
            >
              {m.id}
            </span>
          );
        })}

      {/* Loupe: centered on the cursor, its crosshair is the exact click point. */}
      {view && hover && (
        <span
          className="pointer-events-none absolute z-20 overflow-hidden rounded-full shadow-lg ring-2 ring-line-strong"
          style={{
            width: LOUPE,
            height: LOUPE,
            left: view.left + hover.x * view.width - LOUPE / 2,
            top: view.top + hover.y * view.height - LOUPE / 2,
            backgroundImage: `url("${src}")`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${view.width * loupeScale}px ${view.height * loupeScale}px`,
            backgroundPosition: `${LOUPE / 2 - hover.x * view.width * loupeScale}px ${LOUPE / 2 - hover.y * view.height * loupeScale}px`,
          }}
        >
          {/* Markers under the loupe, at loupe scale (so they stay visible and grabbable). */}
          {here.map((m) => {
            const pos = at(m);
            const lx = LOUPE / 2 + (pos.x - hover.x) * view.width * loupeScale;
            const ly = LOUPE / 2 + (pos.y - hover.y) * view.height * loupeScale;
            if (lx < -12 || ly < -12 || lx > LOUPE + 12 || ly > LOUPE + 12) return null;
            return (
              <span
                key={m.id}
                className={cn(
                  'tnum absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-2xs font-semibold',
                  m.id === selected ? 'bg-accent text-accent-ink ring-2 ring-bg' : 'bg-surface-4 text-fg ring-1 ring-line-strong',
                )}
                style={{ left: lx, top: ly }}
              >
                {m.id}
              </span>
            );
          })}
          <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-accent/70" />
          <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-accent/70" />
        </span>
      )}

      {/* Reference: where the selected point is in another frame. */}
      {view && ref && refUrl && (
        <Tooltip content={`Point ${sel!.id} in ${ref.image}`} side="right">
          <span className="absolute left-3 top-3 z-30 flex cursor-default flex-col overflow-hidden rounded-md bg-surface-2 shadow-lg ring-1 ring-line-strong" {...controlZone}>
            <span
              className="relative block"
              style={{
                width: LOUPE,
                height: LOUPE,
                backgroundImage: `url("${refUrl}")`,
                backgroundRepeat: 'no-repeat',
                backgroundSize: `${LOUPE * LOUPE_ZOOM}px ${LOUPE * LOUPE_ZOOM * aspect}px`,
                backgroundPosition: `${LOUPE / 2 - ref.x * LOUPE * LOUPE_ZOOM}px ${LOUPE / 2 - ref.y * LOUPE * LOUPE_ZOOM * aspect}px`,
              }}
            >
              <span className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-accent" />
            </span>
            <span className="tnum flex h-6 items-center justify-center text-2xs text-fg-muted">#{sel!.id}</span>
          </span>
        </Tooltip>
      )}

      {/* Zoom level (reserved slot, shown only when zoomed in). */}
      <span
        className={cn(
          'tnum pointer-events-none absolute right-3 top-3 z-30 rounded-full bg-overlay px-2 py-0.5 text-2xs text-fg-muted ring-1 ring-line backdrop-blur',
          zoom.z <= 1.01 && 'invisible',
        )}
      >
        {zoom.z.toFixed(1)}× · 0 to fit
      </span>

      {/* Point bar: pick which point the next click places. The padded wrapper hides the loupe near it. */}
      <div className="absolute bottom-0 left-1/2 z-30 max-w-full -translate-x-1/2 cursor-default p-3" {...controlZone}>
        <div className="flex items-center gap-1 rounded-full bg-overlay p-1 shadow-lg ring-1 ring-line backdrop-blur">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {tracks.map((t) => {
              const inThis = t.points.some((p) => p.image === image);
              return (
                <Tooltip key={t.id} content={`Point ${t.id} · ${t.points.length} frame${t.points.length === 1 ? '' : 's'}${inThis ? ' · placed here' : ''}`} side="top">
                  <button
                    type="button"
                    onClick={() => tp.getState().selectTrack(t.id)}
                    className={cn(
                      'tnum flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-2xs font-semibold',
                      t.id === selected ? 'bg-accent text-accent-ink' : inThis ? 'bg-surface-4 text-fg' : 'text-fg-muted ring-1 ring-line hover:text-fg',
                    )}
                  >
                    {t.id}
                    {t.points.length < 2 && <span className="ml-0.5 size-1 rounded-full bg-warning" />}
                  </button>
                </Tooltip>
              );
            })}
          </div>
          <IconButton icon={Plus} label="New point (N)" size="sm" active={selected === undefined} onClick={() => tp.getState().selectTrack(undefined)} tooltipSide="top" />
          <IconButton
            icon={Trash2}
            label="Delete selected point in all frames"
            size="sm"
            disabled={selected === undefined}
            onClick={() => selected !== undefined && tp.getState().deleteTrack(selected)}
            tooltipSide="top"
          />
        </div>
      </div>
    </div>
  );
}
