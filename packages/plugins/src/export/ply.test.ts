import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applySimilarity, IDENTITY, rotate, type Quat, type Similarity, type Vec3 } from '@splatcraft/core';
import { afterAll, describe, expect, it } from 'vitest';
import { parsePlyHeader, shBand, shRotationMatrices, transformPly, transformPlyBuffer } from './ply.js';

/* ---------- helpers ---------- */

let seed = 12345;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const randn = () => rand() * 2 - 1;
const randQuat = (): Quat => {
  const q: Quat = [randn(), randn(), randn(), randn()];
  const l = Math.hypot(...q);
  return q.map((v) => v / l) as Quat;
};
const randDir = (): Vec3 => {
  const d: Vec3 = [randn(), randn(), randn()];
  const l = Math.hypot(...d);
  return d.map((v) => v / l) as Vec3;
};

interface SynthOpts {
  n: number;
  K: number; // f_rest coefficients per channel
  format?: 'binary_little_endian' | 'binary_big_endian';
  extraElement?: boolean;
}

/** Synthetic 3DGS PLY with an odd property order and a few extra props. */
function synthPly({ n, K, format = 'binary_little_endian', extraElement }: SynthOpts) {
  const props: [string, string][] = [
    ['opacity', 'float'],
    ['x', 'float'], ['y', 'float'], ['z', 'float'],
    ['nx', 'float'], ['ny', 'float'], ['nz', 'float'],
    ['f_dc_0', 'float'], ['f_dc_1', 'float'], ['f_dc_2', 'float'],
    ...Array.from({ length: 3 * K }, (_, i) => [`f_rest_${i}`, 'float'] as [string, string]),
    ['scale_0', 'float'], ['scale_1', 'float'], ['scale_2', 'float'],
    ['rot_0', 'float'], ['rot_1', 'float'], ['rot_2', 'float'], ['rot_3', 'float'],
    ['label', 'uchar'],
    ['weight', 'double'],
  ];
  const header = [
    'ply',
    `format ${format} 1.0`,
    'comment made by a test',
    `element vertex ${n}`,
    ...props.map(([name, t]) => `property ${t} ${name}`),
    ...(extraElement ? ['element face 2', 'property list uchar int vertex_indices'] : []),
    'end_header',
    '',
  ].join('\n');
  const size = (t: string) => (t === 'uchar' ? 1 : t === 'double' ? 8 : 4);
  const stride = props.reduce((s, [, t]) => s + size(t), 0);
  const body = Buffer.alloc(n * stride);
  const le = format === 'binary_little_endian';
  const values: Record<string, number>[] = [];
  for (let v = 0; v < n; v++) {
    const rec: Record<string, number> = {};
    let o = v * stride;
    for (const [name, t] of props) {
      let val = randn() * 2;
      if (name === 'label') val = Math.floor(rand() * 255);
      if (t === 'uchar') body.writeUInt8(val, o);
      else if (t === 'double') le ? body.writeDoubleLE(val, o) : body.writeDoubleBE(val, o);
      else {
        le ? body.writeFloatLE(val, o) : body.writeFloatBE(val, o);
        val = Math.fround(val);
      }
      rec[name] = val;
      o += size(t);
    }
    values.push(rec);
  }
  const tail = extraElement ? Buffer.from([3, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0]) : Buffer.alloc(0);
  return { buf: Buffer.concat([Buffer.from(header, 'latin1'), body, tail]), props, stride, values, headerLen: header.length, tail };
}

/** Decode all vertices of a binary PLY into name → value records. */
function decode(buf: Buffer): Record<string, number>[] {
  const h = parsePlyHeader(buf);
  const el = h.elements.find((e) => e.name === 'vertex')!;
  const le = h.format === 'binary_little_endian';
  const out: Record<string, number>[] = [];
  let o = h.headerBytes;
  for (let v = 0; v < el.count; v++) {
    const rec: Record<string, number> = {};
    for (const p of el.properties) {
      if (p.type === 'uchar') (rec[p.name] = buf.readUInt8(o)), (o += 1);
      else if (p.type === 'double') (rec[p.name] = le ? buf.readDoubleLE(o) : buf.readDoubleBE(o)), (o += 8);
      else (rec[p.name] = le ? buf.readFloatLE(o) : buf.readFloatBE(o)), (o += 4);
    }
    out.push(rec);
  }
  return out;
}

/** Evaluate the view-dependent (non-DC) SH colour of one channel. */
function evalRest(rec: Record<string, number>, K: number, c: number, d: Vec3) {
  const degree = { 3: 1, 8: 2, 15: 3 }[K]!;
  let acc = 0;
  let off = 0;
  for (let l = 1; l <= degree; l++) {
    const b = shBand(l, d);
    for (let i = 0; i < b.length; i++) acc += b[i] * rec[`f_rest_${c * K + off + i}`];
    off += b.length;
  }
  return acc;
}

const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/* ---------- tests ---------- */

describe('parsePlyHeader', () => {
  it('reads format, comments, elements and properties', () => {
    const { buf, props, headerLen } = synthPly({ n: 3, K: 15, extraElement: true });
    const h = parsePlyHeader(buf);
    expect(h.format).toBe('binary_little_endian');
    expect(h.comments).toEqual(['made by a test']);
    expect(h.headerBytes).toBe(headerLen);
    expect(h.elements.map((e) => [e.name, e.count])).toEqual([['vertex', 3], ['face', 2]]);
    expect(h.elements[0].properties.map((p) => p.name)).toEqual(props.map(([n]) => n));
    expect(h.elements[1].properties[0]).toEqual({ name: 'vertex_indices', type: 'int', listCountType: 'uchar' });
  });

  it('rejects non-PLY input', () => {
    expect(() => parsePlyHeader(Buffer.from('hello'))).toThrow(/Not a PLY/);
  });
});

describe('SH rotation matrices', () => {
  it('are orthogonal and identity for the identity rotation', () => {
    const I = shRotationMatrices([0, 0, 0, 1]);
    for (const M of I) M.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(i === j ? 1 : 0, 10)));
    for (const M of shRotationMatrices(randQuat())) {
      const n = M.length;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          let s = 0;
          for (let k = 0; k < n; k++) s += M[k][i] * M[k][j];
          expect(s).toBeCloseTo(i === j ? 1 : 0, 9);
        }
      }
    }
  });

  it.each([1, 2, 3])('band %i: f(d) = f\'(R·d)', (l) => {
    for (let trial = 0; trial < 5; trial++) {
      const q = randQuat();
      const M = shRotationMatrices(q, l)[l - 1];
      const c = Array.from({ length: 2 * l + 1 }, randn);
      const c2 = M.map((row) => row.reduce((s, v, j) => s + v * c[j], 0));
      for (let k = 0; k < 10; k++) {
        const d = randDir();
        const before = shBand(l, d).reduce((s, b, i) => s + b * c[i], 0);
        const after = shBand(l, rotate(q, d)).reduce((s, b, i) => s + b * c2[i], 0);
        expect(after).toBeCloseTo(before, 10);
      }
    }
  });
});

describe('transformPlyBuffer', () => {
  const t: Similarity = { scale: 2.5, rotation: randQuat(), translation: [1, -2, 3] };

  it.each([3, 8, 15])('transforms every field (K=%i)', (K) => {
    const { buf, values, headerLen } = synthPly({ n: 20, K });
    const out = transformPlyBuffer(buf, t);
    expect(out.length).toBe(buf.length);
    expect(out.subarray(0, headerLen).equals(buf.subarray(0, headerLen))).toBe(true);
    const got = decode(out);
    for (let v = 0; v < values.length; v++) {
      const a = values[v];
      const b = got[v];
      // Position
      const p = applySimilarity(t, [a.x, a.y, a.z]);
      expect(b.x).toBeCloseTo(p[0], 4);
      expect(b.y).toBeCloseTo(p[1], 4);
      expect(b.z).toBeCloseTo(p[2], 4);
      // Normal
      const n = rotate(t.rotation, [a.nx, a.ny, a.nz]);
      expect(b.nx).toBeCloseTo(n[0], 5);
      expect(b.nz).toBeCloseTo(n[2], 5);
      // Log scale
      for (const s of ['scale_0', 'scale_1', 'scale_2']) expect(b[s]).toBeCloseTo(a[s] + Math.log(2.5), 5);
      // Rotation: R ⊗ normalize(q), 3DGS stores (w, x, y, z)
      const l = Math.hypot(a.rot_0, a.rot_1, a.rot_2, a.rot_3);
      const q = qmul(t.rotation, [a.rot_1 / l, a.rot_2 / l, a.rot_3 / l, a.rot_0 / l]);
      expect([b.rot_1, b.rot_2, b.rot_3, b.rot_0].map((x, i) => x - q[i]).every((d) => Math.abs(d) < 1e-5)).toBe(true);
      // Untouched fields keep their exact values
      for (const k of ['opacity', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'label', 'weight']) expect(b[k]).toBe(a[k]);
      // SH: colour seen from d before equals colour seen from R·d after
      for (let c = 0; c < 3; c++) {
        const d = randDir();
        expect(evalRest(b, K, c, rotate(t.rotation, d))).toBeCloseTo(evalRest(a, K, c, d), 4);
      }
    }
  });

  it('handles big-endian files', () => {
    const { buf, values } = synthPly({ n: 5, K: 3, format: 'binary_big_endian' });
    const got = decode(transformPlyBuffer(buf, t));
    const p = applySimilarity(t, [values[2].x, values[2].y, values[2].z]);
    expect(got[2].x).toBeCloseTo(p[0], 4);
    expect(got[2].opacity).toBe(values[2].opacity);
  });

  it('identity keeps the file (near) unchanged', () => {
    const { buf, values } = synthPly({ n: 30, K: 15 });
    const out = transformPlyBuffer(buf, IDENTITY);
    const got = decode(out);
    for (let v = 0; v < values.length; v++) {
      for (const k of Object.keys(values[v])) {
        if (k.startsWith('rot_')) continue; // normalised
        expect(got[v][k]).toBeCloseTo(values[v][k], 6);
      }
      expect(got[v].x).toBe(values[v].x);
    }
  });

  it('rejects unsupported SH layouts', () => {
    const { buf } = synthPly({ n: 2, K: 4 });
    expect(() => transformPlyBuffer(buf, t)).toThrow(/SH layout/);
  });
});

describe('transformPly (streaming)', () => {
  const dirP = mkdtemp(path.join(tmpdir(), 'ply-test-'));
  afterAll(async () => rm(await dirP, { recursive: true, force: true }));
  const t: Similarity = { scale: 0.3, rotation: randQuat(), translation: [0.5, 0, -1] };

  it('matches the in-memory transform across chunk boundaries and keeps trailing elements', async () => {
    const dir = await dirP;
    const { buf, tail } = synthPly({ n: 101, K: 8, extraElement: true });
    const src = path.join(dir, 'in.ply');
    const dest = path.join(dir, 'out.ply');
    await writeFile(src, buf);
    const progress: number[] = [];
    const res = await transformPly(src, dest, t, { chunkVertices: 7, onProgress: (f) => progress.push(f) });
    expect(res).toEqual({ vertices: 101, format: 'binary_little_endian', shDegree: 2 });
    const out = await readFile(dest);
    expect(out.equals(transformPlyBuffer(buf, t))).toBe(true);
    expect(out.subarray(out.length - tail.length).equals(tail)).toBe(true);
    expect(progress.at(-1)).toBe(1);
  });

  it('transforms ASCII files', async () => {
    const dir = await dirP;
    const text = [
      'ply', 'format ascii 1.0', 'comment hi', 'element vertex 2',
      'property float x', 'property float y', 'property float z',
      'property float scale_0', 'property float scale_1', 'property float scale_2',
      'property float rot_0', 'property float rot_1', 'property float rot_2', 'property float rot_3',
      'property uchar red',
      'end_header',
      '1 2 3 0 0 0 1 0 0 0 200',
      '-1 0.5 0 -1 -1 -1 2 0 0 0 7',
      '',
    ].join('\n');
    const src = path.join(dir, 'a.ply');
    const dest = path.join(dir, 'a-out.ply');
    await writeFile(src, text);
    const tt: Similarity = { scale: 2, rotation: [0, 0, 0, 1], translation: [1, 1, 1] };
    await transformPly(src, dest, tt);
    const lines = (await readFile(dest, 'latin1')).split('\n');
    expect(lines.slice(0, 16).join('\n')).toBe(text.split('\n').slice(0, 16).join('\n'));
    const v0 = lines[16].split(' ').map(Number);
    expect(v0.slice(0, 3)).toEqual([3, 5, 7]);
    expect(v0[3]).toBeCloseTo(Math.log(2), 6);
    expect(v0.slice(6)).toEqual([1, 0, 0, 0, 200]);
    const v1 = lines[17].split(' ').map(Number);
    expect(v1.slice(0, 3)).toEqual([-1, 2, 1]);
    expect(v1[6]).toBe(1); // normalised
    expect(v1[10]).toBe(7);
  });
});
