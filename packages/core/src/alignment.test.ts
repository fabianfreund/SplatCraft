import { describe, expect, it } from 'vitest';
import { alignmentTransform, applySimilarity, isIdentity, orientTowards, type Vec3 } from './alignment.js';

const close = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe('alignmentTransform', () => {
  it('is the identity without input', () => {
    expect(isIdentity(alignmentTransform(undefined))).toBe(true);
    expect(isIdentity(alignmentTransform({}))).toBe(true);
  });

  it('levels a tilted plane onto y = 0 with up = -y', () => {
    // Plane x + y = 2 (tilted 45°), points around (1, 1, 0), seen from the origin side.
    const pts = orientTowards([[2, 0, 0], [0, 2, 0], [1, 1, 3]], [0, 0, 0]);
    const t = alignmentTransform({ ground: { points: pts } });
    for (const p of pts) expect(applySimilarity(t, p)[1]).toBeCloseTo(0, 6);
    // A point on the viewer's side ends up above (y < 0 in file coords).
    expect(applySimilarity(t, [1, 0, 1])[1]).toBeLessThan(0);
    // Flip puts it below.
    const f = alignmentTransform({ ground: { points: pts, flip: true } });
    expect(applySimilarity(f, [1, 0, 1])[1]).toBeGreaterThan(0);
  });

  it('scales so the reference has its real length in meters', () => {
    const t = alignmentTransform({ scale: { a: [0, 0, 0], b: [0, 0, 2], distance: 50, unit: 'cm' } });
    expect(t.scale).toBeCloseTo(0.25);
    close(applySimilarity(t, [0, 0, 2]), [0, 0, 0.5]);
  });

  it('combines ground and scale around the plane centroid', () => {
    const pts = orientTowards([[0, 3, 0], [1, 3, 0], [0, 3, 1]], [0, 0, 0]);
    const t = alignmentTransform({ ground: { points: pts }, scale: { a: [0, 0, 0], b: [1, 0, 0], distance: 1, unit: 'in' } });
    close(applySimilarity(t, [1 / 3, 3, 1 / 3]), [0, 0, 0]);
    expect(applySimilarity(t, [1 / 3, 2, 1 / 3])[1]).toBeCloseTo(-0.0254, 6);
  });
});
