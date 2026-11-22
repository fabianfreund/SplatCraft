/**
 * Feature points (tie points): the user clicks the same spot in several frames.
 * Each track becomes extra keypoints plus matches in COLMAP's database.
 *
 * Order in the COLMAP stage:
 *   features → loose matching of tracked image pairs → normal matching →
 *   injectTiePoints (append keypoints, merge their matches into the tracked
 *   pairs' raw matches, drop those pairs' verification) →
 *   `matches_importer --match_type raw` re-verifies the tracked pairs → mapper.
 * Appending after matching keeps every existing keypoint index valid, and the
 * re-verification estimates real two-view geometry from SIFT + clicked matches.
 */
import { z } from 'zod';

export const tiePointSchema = z.object({
  /** Frame file name. */
  image: z.string(),
  /** Position as a fraction of the image width / height (0..1, origin top-left). */
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export const tieTrackSchema = z.object({ id: z.number().int(), points: z.array(tiePointSchema) });
export type TiePoint = z.infer<typeof tiePointSchema>;
export type TieTrack = z.infer<typeof tieTrackSchema>;

/** Tracks limited to known frames, one point per frame (the last wins), at least two frames each. */
export function normalizeTracks(tracks: readonly TieTrack[], names: readonly string[]): TieTrack[] {
  const known = new Set(names);
  const out: TieTrack[] = [];
  for (const t of tracks) {
    const byImage = new Map<string, TiePoint>();
    for (const p of t.points) if (known.has(p.image)) byImage.set(p.image, p);
    if (byImage.size >= 2) out.push({ id: t.id, points: [...byImage.values()] });
  }
  return out;
}

/** Every frame pair that shares at least one track (sorted, unique). */
export function trackPairs(tracks: readonly TieTrack[]): [string, string][] {
  const seen = new Map<string, [string, string]>();
  for (const t of tracks) {
    const imgs = [...new Set(t.points.map((p) => p.image))].sort();
    for (let i = 0; i < imgs.length; i++)
      for (let j = i + 1; j < imgs.length; j++) seen.set(`${imgs[i]}\n${imgs[j]}`, [imgs[i]!, imgs[j]!]);
  }
  return [...seen.values()].sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
}

/** COLMAP's pair id (image ids ordered). */
export const pairId = (a: number, b: number) => (a < b ? a * 2147483647 + b : b * 2147483647 + a);

const SCALE = 4; // keypoint "size" in px for the affine shape; only used for display/undistortion

/** Minimal surface of node:sqlite's DatabaseSync that this module uses (eases testing). */
interface Db {
  prepare(sql: string): { all(...p: any[]): any[]; get(...p: any[]): any; run(...p: any[]): unknown };
  exec(sql: string): void;
}

const bytes = (v: unknown): Uint8Array => (v instanceof Uint8Array ? v : new Uint8Array(0));

/**
 * Adds the tracks to an open COLMAP database and returns the raw match list
 * (`matches_importer --match_type raw`) for the tracked pairs, or '' when
 * nothing applies. Returns how many points were added.
 */
export function injectTiePoints(db: Db, tracks: readonly TieTrack[]): { rawMatches: string; points: number; pairs: number } {
  const images = new Map<string, { id: number; width: number; height: number }>();
  for (const r of db.prepare('SELECT i.image_id AS id, i.name AS name, c.width AS w, c.height AS h FROM images i JOIN cameras c ON c.camera_id = i.camera_id').all())
    images.set(String(r.name), { id: Number(r.id), width: Number(r.w), height: Number(r.h) });
  const usable = normalizeTracks(tracks, [...images.keys()]);
  if (!usable.length) return { rawMatches: '', points: 0, pairs: 0 };

  db.exec('BEGIN');
  try {
    // 1. Append one keypoint per (track, image); remember its index.
    const index = new Map<string, number>(); // `${trackId}|${image}` → keypoint index
    const perImage = new Map<string, TiePoint[]>();
    const trackOf = new Map<TiePoint, number>();
    for (const t of usable)
      for (const p of t.points) {
        perImage.set(p.image, [...(perImage.get(p.image) ?? []), p]);
        trackOf.set(p, t.id);
      }
    let added = 0;
    for (const [name, pts] of perImage) {
      const img = images.get(name)!;
      const kp = db.prepare('SELECT rows, cols, data FROM keypoints WHERE image_id = ?').get(img.id);
      const rows = Number(kp?.rows ?? 0);
      const cols = Number(kp?.cols ?? 6) || 6;
      const old = new Float32Array(rows * cols);
      old.set(new Float32Array(bytes(kp?.data).slice().buffer, 0, rows * cols));
      const next = new Float32Array((rows + pts.length) * cols);
      next.set(old);
      pts.forEach((p, i) => {
        const o = (rows + i) * cols;
        next[o] = p.x * img.width;
        next[o + 1] = p.y * img.height;
        if (cols === 4) next[o + 2] = SCALE; // x, y, scale, orientation
        if (cols === 6) (next[o + 2] = SCALE), (next[o + 5] = SCALE); // x, y, a11, a12, a21, a22
        index.set(`${trackOf.get(p)}|${name}`, rows + i);
      });
      if (kp) db.prepare('UPDATE keypoints SET rows = ?, cols = ?, data = ? WHERE image_id = ?').run(rows + pts.length, cols, new Uint8Array(next.buffer), img.id);
      else db.prepare('INSERT INTO keypoints (image_id, rows, cols, data) VALUES (?, ?, ?, ?)').run(img.id, pts.length, cols, new Uint8Array(next.buffer));
      // Keep descriptor rows in step with keypoints (zero descriptors never pass the matcher's ratio test).
      const d = db.prepare('SELECT rows, cols, data FROM descriptors WHERE image_id = ?').get(img.id);
      if (d) {
        const dc = Number(d.cols);
        const width = Number(d.rows) * dc;
        const elem = Math.max(1, Math.round(bytes(d.data).byteLength / Math.max(1, width))); // uint8 or float32 descriptors
        const nd = new Uint8Array((Number(d.rows) + pts.length) * dc * elem);
        nd.set(bytes(d.data));
        db.prepare('UPDATE descriptors SET rows = ?, data = ? WHERE image_id = ?').run(Number(d.rows) + pts.length, nd, img.id);
      }
      added += pts.length;
    }

    // 2. For every tracked pair: existing raw matches + clicked matches, then drop the
    //    pair's matches and verification so matches_importer re-verifies them together.
    const pairs = trackPairs(usable);
    const blocks: string[] = [];
    for (const [a, b] of pairs) {
      const ia = images.get(a)!;
      const ib = images.get(b)!;
      const [first, second] = ia.id < ib.id ? [a, b] : [b, a];
      const id1 = images.get(first)!.id;
      const id2 = images.get(second)!.id;
      const pid = pairId(id1, id2);
      const lines: string[] = [];
      const m = db.prepare('SELECT rows, cols, data FROM matches WHERE pair_id = ?').get(pid);
      if (m && Number(m.rows) > 0) {
        const u = new Uint32Array(bytes(m.data).slice().buffer, 0, Number(m.rows) * 2);
        for (let k = 0; k < u.length; k += 2) lines.push(`${u[k]} ${u[k + 1]}`);
      }
      for (const t of usable) {
        const k1 = index.get(`${t.id}|${first}`);
        const k2 = index.get(`${t.id}|${second}`);
        if (k1 !== undefined && k2 !== undefined) lines.push(`${k1} ${k2}`);
      }
      db.prepare('DELETE FROM matches WHERE pair_id = ?').run(pid);
      db.prepare('DELETE FROM two_view_geometries WHERE pair_id = ?').run(pid);
      blocks.push(`${first} ${second}\n${lines.join('\n')}\n`);
    }
    db.exec('COMMIT');
    return { rawMatches: blocks.join('\n'), points: added, pairs: pairs.length };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
