import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { injectTiePoints, normalizeTracks, pairId, trackPairs, type TieTrack } from './tiepoints.js';

const run = promisify(execFile);

describe('tie point tracks', () => {
  it('keeps one point per known frame and drops tracks seen in fewer than two', () => {
    const tracks: TieTrack[] = [
      { id: 1, points: [{ image: 'a.jpg', x: 0.1, y: 0.1 }, { image: 'a.jpg', x: 0.2, y: 0.2 }, { image: 'b.jpg', x: 0.3, y: 0.3 }] },
      { id: 2, points: [{ image: 'a.jpg', x: 0.5, y: 0.5 }, { image: 'gone.jpg', x: 0.5, y: 0.5 }] },
    ];
    expect(normalizeTracks(tracks, ['a.jpg', 'b.jpg'])).toEqual([{ id: 1, points: [{ image: 'a.jpg', x: 0.2, y: 0.2 }, { image: 'b.jpg', x: 0.3, y: 0.3 }] }]);
  });

  it('lists every frame pair that shares a track once', () => {
    const p = (image: string) => ({ image, x: 0, y: 0 });
    expect(trackPairs([{ id: 1, points: [p('c'), p('a'), p('b')] }, { id: 2, points: [p('b'), p('a')] }])).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ]);
  });
});

/** COLMAP's schema, reduced to the tables injectTiePoints touches. */
function colmapDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE cameras (camera_id INTEGER PRIMARY KEY, model INTEGER, width INTEGER, height INTEGER, params BLOB, prior_focal_length INTEGER);
    CREATE TABLE images (image_id INTEGER PRIMARY KEY, name TEXT UNIQUE, camera_id INTEGER);
    CREATE TABLE keypoints (image_id INTEGER PRIMARY KEY, rows INTEGER, cols INTEGER, data BLOB);
    CREATE TABLE descriptors (image_id INTEGER PRIMARY KEY, type INTEGER, rows INTEGER, cols INTEGER, data BLOB);
    CREATE TABLE matches (pair_id INTEGER PRIMARY KEY, rows INTEGER, cols INTEGER, data BLOB);
    CREATE TABLE two_view_geometries (pair_id INTEGER PRIMARY KEY, rows INTEGER, cols INTEGER, data BLOB, config INTEGER);
    INSERT INTO cameras VALUES (1, 2, 1000, 500, NULL, 0);
    INSERT INTO images VALUES (1, 'a.jpg', 1), (2, 'b.jpg', 1);
  `);
  const kp = new Float32Array([1, 2, 3, 0, 0, 3, 4, 5, 3, 0, 0, 3]); // two SIFT keypoints
  for (const id of [1, 2]) {
    db.prepare('INSERT INTO keypoints VALUES (?, 2, 6, ?)').run(id, new Uint8Array(kp.buffer));
    db.prepare('INSERT INTO descriptors VALUES (?, 0, 2, 128, ?)').run(id, new Uint8Array(256));
  }
  db.prepare('INSERT INTO matches VALUES (?, 1, 2, ?)').run(pairId(1, 2), new Uint8Array(new Uint32Array([0, 1]).buffer));
  db.prepare('INSERT INTO two_view_geometries VALUES (?, 1, 2, ?, 2)').run(pairId(1, 2), new Uint8Array(new Uint32Array([0, 1]).buffer));
  return db;
}

describe('injectTiePoints', () => {
  it('appends keypoints in pixels, keeps descriptors in step and merges the matches for re-verification', () => {
    const db = colmapDb();
    const res = injectTiePoints(db, [{ id: 7, points: [{ image: 'b.jpg', x: 0.25, y: 0.5 }, { image: 'a.jpg', x: 0.5, y: 0.1 }] }]);
    expect(res).toMatchObject({ points: 2, pairs: 1 });
    const kp = db.prepare('SELECT rows, data FROM keypoints WHERE image_id = 1').get() as { rows: number; data: Uint8Array };
    expect(kp.rows).toBe(3);
    expect([...new Float32Array(kp.data.slice().buffer)].slice(12, 14)).toEqual([500, 50]);
    expect((db.prepare('SELECT rows FROM descriptors WHERE image_id = 2').get() as { rows: number }).rows).toBe(3);
    // Existing SIFT match first, then the clicked one (index 2 in both frames), image with the lower id first.
    expect(res.rawMatches).toBe('a.jpg b.jpg\n0 1\n2 2\n');
    expect(db.prepare('SELECT COUNT(*) AS n FROM two_view_geometries').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM matches').get()).toEqual({ n: 0 });
  });

  it('does nothing for tracks on unknown frames', () => {
    const db = colmapDb();
    expect(injectTiePoints(db, [{ id: 1, points: [{ image: 'x.jpg', x: 0, y: 0 }, { image: 'y.jpg', x: 0, y: 0 }] }])).toEqual({ rawMatches: '', points: 0, pairs: 0 });
  });
});

const hasColmap = await run('colmap', ['help']).then(
  () => true,
  () => false,
);

describe.skipIf(!hasColmap)('feature points with the real COLMAP', () => {
  it('clicked points survive re-verification as inlier matches', { timeout: 120_000 }, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tie-'));
    const imgDir = path.join(dir, 'img');
    await mkdir(imgDir);
    // One textured scene, three overlapping crops (offsets 0 / 300 / 600 px).
    const W = 2400, H = 1200;
    const buf = Buffer.alloc(W * H * 3);
    let seed = 7;
    const r = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 4000; i++) {
      const x = Math.floor(r() * W), y = Math.floor(r() * H), w = 5 + Math.floor(r() * 60), h = 5 + Math.floor(r() * 60), c = [r() * 255, r() * 255, r() * 255];
      for (let yy = y; yy < Math.min(H, y + h); yy++) for (let xx = x; xx < Math.min(W, x + w); xx++) buf.set(c, (yy * W + xx) * 3);
    }
    const png = await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
    const offsets = [0, 300, 600];
    for (const [i, x] of offsets.entries()) await sharp(png).extract({ left: x, top: 100, width: 1200, height: 900 }).jpeg({ quality: 92 }).toFile(path.join(imgDir, `f${i}.jpg`));

    const db = path.join(dir, 'db.db');
    const common = ['--log_target', 'stderr', '--log_color', '0'];
    await run('colmap', ['feature_extractor', '--database_path', db, '--image_path', imgDir, '--FeatureExtraction.use_gpu', '0', ...common]);
    await run('colmap', ['exhaustive_matcher', '--database_path', db, '--FeatureMatching.use_gpu', '0', ...common]);

    // Ten scene points seen by all three crops.
    const tracks: TieTrack[] = Array.from({ length: 10 }, (_, k) => {
      const bx = 700 + k * 40, by = 300 + (k % 5) * 100;
      return { id: k + 1, points: offsets.map((o, i) => ({ image: `f${i}.jpg`, x: (bx - o) / 1200, y: (by - 100) / 900 })) };
    });
    const sql = new DatabaseSync(db);
    const before = new Map((sql.prepare('SELECT image_id AS id, rows FROM keypoints').all() as { id: number; rows: number }[]).map((x) => [x.id, x.rows]));
    const res = injectTiePoints(sql, tracks);
    sql.close();
    expect(res).toMatchObject({ points: 30, pairs: 3 });
    const raw = path.join(dir, 'raw.txt');
    await writeFile(raw, res.rawMatches);
    await run('colmap', ['matches_importer', '--database_path', db, '--match_list_path', raw, '--match_type', 'raw', '--FeatureMatching.use_gpu', '0', ...common]);

    const after = new DatabaseSync(db);
    const geoms = after.prepare('SELECT pair_id, rows, data, config FROM two_view_geometries').all() as { pair_id: number; rows: number; data: Uint8Array; config: number }[];
    expect(geoms).toHaveLength(3);
    for (const g of geoms) {
      const id1 = Math.floor(g.pair_id / 2147483647);
      const id2 = g.pair_id % 2147483647;
      const inl = new Uint32Array(g.data.slice().buffer);
      let clicked = 0;
      for (let k = 0; k < inl.length; k += 2) if (inl[k]! >= before.get(id1)! && inl[k + 1]! >= before.get(id2)!) clicked++;
      expect(g.config).toBeGreaterThanOrEqual(2); // verified geometry
      expect(clicked).toBe(10); // every clicked match is an inlier
    }
    after.close();
  });
});
