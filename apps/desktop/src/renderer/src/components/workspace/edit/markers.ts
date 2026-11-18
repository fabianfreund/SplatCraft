import { distance, metersPerUnit, UNIT_TO_METERS, type LengthUnit, type SceneAlignment, type Vec3 } from '@splatcraft/core/alignment';
import type { ViewerMarkers } from '../../../viewer/ViewerAPI';
import type { EditTool } from '../../../store/edit';

const UNIT_DIGITS: Record<LengthUnit, number> = { m: 3, cm: 1, mm: 0, in: 2 };

export function formatLength(value: number, unit: LengthUnit): string {
  return `${+value.toFixed(UNIT_DIGITS[unit])} ${unit}`;
}

/** Length between two file-space points in `unit`, if the scene has a scale. */
export function realLength(a: Vec3, b: Vec3, al: SceneAlignment | undefined, unit: LengthUnit): number | undefined {
  const mpu = metersPerUnit(al?.scale);
  return mpu === undefined ? undefined : (distance(a, b) * mpu) / UNIT_TO_METERS[unit];
}

/**
 * What the viewer draws: the saved ground triangle and scale line (when `showSaved`),
 * plus the points picked so far with the active tool.
 */
export function buildMarkers(al: SceneAlignment | undefined, showSaved: boolean, tool: EditTool | null, draft: Vec3[], hover?: Vec3 | null): ViewerMarkers {
  const m: ViewerMarkers = { points: [], lines: [], triangles: [] };
  if (showSaved && al?.ground && tool !== 'ground') {
    m.triangles.push({ points: al.ground.points, tone: 'ground' });
    m.points.push(...al.ground.points.map((p) => ({ p, tone: 'ground' as const })));
  }
  if (showSaved && al?.scale && tool !== 'measure') {
    const { a, b, distance: d, unit } = al.scale;
    m.lines.push({ a, b, tone: 'measure', label: formatLength(d, unit) });
    m.points.push({ p: a, tone: 'measure' }, { p: b, tone: 'measure' });
  }
  if (tool) {
    const tone = tool === 'ground' ? 'ground' : 'measure';
    // The cursor acts as the next point: live preview of the line / triangle.
    const pts = hover ? [...draft, hover] : draft;
    m.points.push(...pts.map((p) => ({ p, tone }) as const));
    for (let i = 1; i < pts.length; i++) {
      const live = tool === 'measure' && hover && i === pts.length - 1 ? realLength(pts[i - 1], pts[i], al, al?.scale?.unit ?? 'm') : undefined;
      m.lines.push({ a: pts[i - 1], b: pts[i], tone, label: tool === 'measure' ? (live !== undefined ? formatLength(live, al!.scale!.unit) : undefined) : undefined });
    }
    if (tool === 'ground' && pts.length === 3) {
      m.triangles.push({ points: pts as [Vec3, Vec3, Vec3], tone });
      m.lines.push({ a: pts[2], b: pts[0], tone });
    }
  }
  return m;
}
