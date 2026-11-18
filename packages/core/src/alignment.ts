/**
 * Scene alignment: level a scene on a ground plane and give it a real-world
 * scale. Pure math, no Node or DOM imports, so the renderer can use it too
 * (`@splatcraft/core/alignment`).
 *
 * Coordinates are those of the splat / COLMAP files (y points down). "Up" is
 * therefore -y, which is what every 3DGS viewer shows as up after its usual
 * 180° flip around x.
 */

export type Vec3 = [number, number, number];
/** Quaternion [x, y, z, w]. */
export type Quat = [number, number, number, number];

export const LENGTH_UNITS = ['m', 'cm', 'mm', 'in'] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];
export const UNIT_TO_METERS: Record<LengthUnit, number> = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254 };

/** Up direction in file coordinates. */
export const FILE_UP: Vec3 = [0, -1, 0];

export interface GroundPlane {
  /**
   * Three points on the ground, in file coordinates. Their winding defines up:
   * (p1 − p0) × (p2 − p0) points to the side that becomes up (see `orientTowards`).
   */
  points: [Vec3, Vec3, Vec3];
  /** Use the other side of the plane as up. */
  flip?: boolean;
}

export interface ScaleReference {
  /** Two points in file coordinates. */
  a: Vec3;
  b: Vec3;
  /** Real distance between `a` and `b`, in `unit`. */
  distance: number;
  unit: LengthUnit;
}

export interface SceneAlignment {
  ground?: GroundPlane;
  scale?: ScaleReference;
}

/** Similarity transform `p' = scale · R(rotation) · p + translation`. */
export interface Similarity {
  scale: number;
  rotation: Quat;
  translation: Vec3;
}

export const IDENTITY: Similarity = { scale: 1, rotation: [0, 0, 0, 1], translation: [0, 0, 0] };

const EPS = 1e-9;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const scaleV = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

export const distance = (a: Vec3, b: Vec3) => len(sub(a, b));

/** Unit normal of the plane through three points (null if they are collinear). */
export function planeNormal([p0, p1, p2]: [Vec3, Vec3, Vec3]): Vec3 | null {
  const n = cross(sub(p1, p0), sub(p2, p0));
  const l = len(n);
  return l < EPS ? null : scaleV(n, 1 / l);
}

/** Reorders the points so their winding normal faces `eye` (the side the user looked from). */
export function orientTowards(points: [Vec3, Vec3, Vec3], eye: Vec3): [Vec3, Vec3, Vec3] {
  const n = planeNormal(points);
  if (!n) return points;
  const c = centroid(points);
  return dot(n, sub(eye, c)) >= 0 ? points : [points[0], points[2], points[1]];
}

export function centroid([a, b, c]: [Vec3, Vec3, Vec3]): Vec3 {
  return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
}

/** Shortest-arc rotation taking unit vector `from` onto unit vector `to`. */
export function rotationBetween(from: Vec3, to: Vec3): Quat {
  const d = dot(from, to);
  if (d < -1 + 1e-9) {
    // Opposite: rotate 180° around any axis perpendicular to `from`.
    let axis = cross([1, 0, 0], from);
    if (len(axis) < 1e-6) axis = cross([0, 0, 1], from);
    const a = scaleV(axis, 1 / len(axis));
    return [a[0], a[1], a[2], 0];
  }
  const c = cross(from, to);
  const q: Quat = [c[0], c[1], c[2], 1 + d];
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  // v + 2w(u×v) + 2u×(u×v), u = (x, y, z)
  const u: Vec3 = [x, y, z];
  const t = scaleV(cross(u, v), 2);
  const r = cross(u, t);
  return [v[0] + w * t[0] + r[0], v[1] + w * t[1] + r[1], v[2] + w * t[2] + r[2]];
}

/** Meters per file unit implied by a scale reference (undefined if unusable). */
export function metersPerUnit(s: ScaleReference | undefined): number | undefined {
  if (!s) return undefined;
  const d = distance(s.a, s.b);
  const m = s.distance * (UNIT_TO_METERS[s.unit] ?? NaN);
  return d > EPS && Number.isFinite(m) && m > 0 ? m / d : undefined;
}

/**
 * The transform that puts the ground plane's centroid at the origin with its
 * normal pointing up, and scales the scene so one unit is one meter.
 */
export function alignmentTransform(al: SceneAlignment | undefined): Similarity {
  if (!al) return IDENTITY;
  const scale = metersPerUnit(al.scale) ?? 1;
  let rotation: Quat = [0, 0, 0, 1];
  let center: Vec3 = [0, 0, 0];
  const n = al.ground && planeNormal(al.ground.points);
  if (al.ground && n) {
    const up = al.ground.flip ? scaleV(n, -1) : n;
    rotation = rotationBetween(up, FILE_UP);
    center = centroid(al.ground.points);
  }
  const translation = scaleV(rotate(rotation, center), -scale);
  return { scale, rotation, translation };
}

export function applySimilarity(t: Similarity, p: Vec3): Vec3 {
  const r = rotate(t.rotation, p);
  return [t.scale * r[0] + t.translation[0], t.scale * r[1] + t.translation[1], t.scale * r[2] + t.translation[2]];
}

export function isIdentity(t: Similarity): boolean {
  return Math.abs(t.scale - 1) < EPS && Math.abs(t.rotation[3]) > 1 - EPS && len(t.translation) < EPS;
}

/** Column-major 4×4 matrix (three.js `Matrix4.fromArray` order). */
export function similarityMatrix(t: Similarity): number[] {
  const [x, y, z, w] = t.rotation;
  const s = t.scale;
  const [tx, ty, tz] = t.translation;
  return [
    s * (1 - 2 * (y * y + z * z)), s * 2 * (x * y + z * w), s * 2 * (x * z - y * w), 0,
    s * 2 * (x * y - z * w), s * (1 - 2 * (x * x + z * z)), s * 2 * (y * z + x * w), 0,
    s * 2 * (x * z + y * w), s * 2 * (y * z - x * w), s * (1 - 2 * (x * x + y * y)), 0,
    tx, ty, tz, 1,
  ];
}
