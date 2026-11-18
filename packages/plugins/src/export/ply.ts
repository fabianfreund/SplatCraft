/**
 * Apply a similarity transform (scale · rotation + translation) to a 3D
 * Gaussian Splatting PLY: positions, normals, rotations, log-scales and the
 * view-dependent spherical-harmonic colour coefficients.
 *
 * Binary files (little or big endian) are streamed in chunks of vertices, so
 * memory stays flat for files of any size. ASCII files are read whole.
 * Every property, comment and extra element is preserved; properties the
 * transform does not touch keep their exact bytes.
 */
import { open, readFile, writeFile } from 'node:fs/promises';
import type { Quat, Similarity } from '@splatcraft/core';

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

export type PlyScalarType = 'char' | 'uchar' | 'short' | 'ushort' | 'int' | 'uint' | 'float' | 'double';
export type PlyFormat = 'ascii' | 'binary_little_endian' | 'binary_big_endian';

export interface PlyProperty {
  name: string;
  /** Scalar type, or the item type of a list property. */
  type: PlyScalarType;
  /** Set for `property list <countType> <type> <name>`. */
  listCountType?: PlyScalarType;
}

export interface PlyElement {
  name: string;
  count: number;
  properties: PlyProperty[];
}

export interface PlyHeader {
  format: PlyFormat;
  /** Raw header lines up to and including `end_header` (re-emitted verbatim). */
  lines: string[];
  comments: string[];
  elements: PlyElement[];
  /** Byte length of the header, including the newline after `end_header`. */
  headerBytes: number;
}

const TYPE_ALIASES: Record<string, PlyScalarType> = {
  char: 'char', int8: 'char',
  uchar: 'uchar', uint8: 'uchar',
  short: 'short', int16: 'short',
  ushort: 'ushort', uint16: 'ushort',
  int: 'int', int32: 'int',
  uint: 'uint', uint32: 'uint',
  float: 'float', float32: 'float',
  double: 'double', float64: 'double',
};

export const PLY_TYPE_SIZE: Record<PlyScalarType, number> = {
  char: 1, uchar: 1, short: 2, ushort: 2, int: 4, uint: 4, float: 4, double: 8,
};

function scalarType(t: string | undefined, line: string): PlyScalarType {
  const s = t && TYPE_ALIASES[t];
  if (!s) throw new Error(`PLY: unknown property type in "${line}"`);
  return s;
}

/** Index of the first byte after the `end_header` line, or -1. */
function headerEnd(buf: Buffer): number {
  const i = buf.indexOf('end_header');
  if (i < 0) return -1;
  const nl = buf.indexOf(0x0a, i);
  return nl < 0 ? -1 : nl + 1;
}

/** Parse a PLY header from the start of `buf`. */
export function parsePlyHeader(buf: Buffer): PlyHeader {
  if (buf.subarray(0, 3).toString('latin1') !== 'ply') throw new Error('Not a PLY file (missing "ply" magic)');
  const headerBytes = headerEnd(buf);
  if (headerBytes < 0) throw new Error('PLY: header has no end_header');
  const lines = buf.subarray(0, headerBytes).toString('latin1').split('\n');
  lines.pop(); // empty string after the final newline
  let format: PlyFormat | undefined;
  const comments: string[] = [];
  const elements: PlyElement[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const t = line.trim().split(/\s+/);
    switch (t[0]) {
      case 'format':
        if (t[1] !== 'ascii' && t[1] !== 'binary_little_endian' && t[1] !== 'binary_big_endian') {
          throw new Error(`PLY: unsupported format "${t[1]}"`);
        }
        format = t[1];
        break;
      case 'comment':
      case 'obj_info':
        comments.push(line.slice(t[0].length).trim());
        break;
      case 'element': {
        const count = Number(t[2]);
        if (!t[1] || !Number.isInteger(count) || count < 0) throw new Error(`PLY: bad element line "${line}"`);
        elements.push({ name: t[1], count, properties: [] });
        break;
      }
      case 'property': {
        const el = elements[elements.length - 1];
        if (!el) throw new Error(`PLY: property before any element: "${line}"`);
        if (t[1] === 'list') {
          el.properties.push({ name: t[4] ?? '', type: scalarType(t[3], line), listCountType: scalarType(t[2], line) });
        } else {
          el.properties.push({ name: t[2] ?? '', type: scalarType(t[1], line) });
        }
        break;
      }
      default:
        break; // ply, end_header, blank
    }
  }
  if (!format) throw new Error('PLY: header has no format line');
  return { format, lines, comments, elements, headerBytes };
}

/** Read and parse just the header of a PLY file. */
export async function readPlyHeader(file: string): Promise<PlyHeader> {
  const fh = await open(file, 'r');
  try {
    let size = 64 * 1024;
    const { size: fileSize } = await fh.stat();
    for (;;) {
      const buf = Buffer.alloc(Math.min(size, fileSize));
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      const b = buf.subarray(0, bytesRead);
      if (headerEnd(b) >= 0 || bytesRead >= fileSize || size >= 16 * 1024 * 1024) return parsePlyHeader(b);
      size *= 4;
    }
  } finally {
    await fh.close();
  }
}

/** Byte size of one instance of a fixed-size element (NaN if it has lists). */
function fixedStride(el: PlyElement): number {
  let s = 0;
  for (const p of el.properties) s += p.listCountType ? NaN : PLY_TYPE_SIZE[p.type];
  return s;
}

/* ------------------------------------------------------------------ */
/* Rotation helpers                                                    */
/* ------------------------------------------------------------------ */

/** Row-major 3×3 rotation matrix of quaternion [x, y, z, w]. */
export function quatToMatrix(q: Quat): number[] {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  const [x, y, z, w] = [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

const SH_C1 = 0.4886025119029199;
const SH_C2 = [1.0925484305920792, -1.0925484305920792, 0.31539156525252005, -1.0925484305920792, 0.5462742152960396];
const SH_C3 = [
  -0.5900435899266435, 2.890611442640554, -0.4570457994644658, 0.3731763325901154,
  -0.4570457994644658, 1.445305721320277, -0.5900435899266435,
];

/**
 * Real SH basis of band `l` (1..3) at unit direction `d`, in the order and
 * with the signs of the reference 3DGS `eval_sh` (gaussian-splatting
 * utils/sh_utils.py). Coefficient `i` of a band multiplies entry `i`.
 */
export function shBand(l: number, d: readonly number[]): number[] {
  const [x, y, z] = d;
  if (l === 1) return [-SH_C1 * y, SH_C1 * z, -SH_C1 * x];
  const xx = x * x, yy = y * y, zz = z * z;
  if (l === 2) {
    return [
      SH_C2[0] * x * y,
      SH_C2[1] * y * z,
      SH_C2[2] * (2 * zz - xx - yy),
      SH_C2[3] * x * z,
      SH_C2[4] * (xx - yy),
    ];
  }
  if (l === 3) {
    return [
      SH_C3[0] * y * (3 * xx - yy),
      SH_C3[1] * x * y * z,
      SH_C3[2] * y * (4 * zz - xx - yy),
      SH_C3[3] * z * (2 * zz - 3 * xx - 3 * yy),
      SH_C3[4] * x * (4 * zz - xx - yy),
      SH_C3[5] * z * (xx - yy),
      SH_C3[6] * x * (xx - 3 * yy),
    ];
  }
  throw new Error(`SH band ${l} not supported`);
}

/** Solve A·X = B in place (A n×n, B n×m, row-major arrays), partial pivoting. */
function solve(A: number[][], B: number[][]): number[][] {
  const n = A.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [B[c], B[p]] = [B[p], B[c]];
    const piv = A[c][c];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / piv;
      if (f === 0) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      for (let k = 0; k < B[r].length; k++) B[r][k] -= f * B[c][k];
    }
  }
  return B.map((row, r) => row.map((v) => v / A[r][r]));
}

/** Well-spread unit directions (Fibonacci sphere). */
function sampleDirections(n: number): number[][] {
  const out: number[][] = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - z * z);
    out.push([r * Math.cos(g * i), r * Math.sin(g * i), z]);
  }
  return out;
}

/**
 * Matrices that rotate SH coefficients of bands 1..`degree`: for coefficient
 * vector `c` of band l, `c' = M[l-1] · c` satisfies
 * `Σ c'_i B_i(R·d) = Σ c_i B_i(d)` for every direction d.
 *
 * Each band is closed under rotation, so the matrix is found exactly (up to
 * float rounding) by a least-squares fit over sample directions.
 * Row-major, (2l+1)×(2l+1).
 */
export function shRotationMatrices(q: Quat, degree = 3): number[][][] {
  const R = quatToMatrix(q);
  // R^T · d (the original direction that maps onto d).
  const back = (d: number[]) => [
    R[0] * d[0] + R[3] * d[1] + R[6] * d[2],
    R[1] * d[0] + R[4] * d[1] + R[7] * d[2],
    R[2] * d[0] + R[5] * d[1] + R[8] * d[2],
  ];
  const dirs = sampleDirections(64);
  const out: number[][][] = [];
  for (let l = 1; l <= degree; l++) {
    const n = 2 * l + 1;
    const A = dirs.map((d) => shBand(l, d)); // rows: samples, cols: basis j
    const Y = dirs.map((d) => shBand(l, back(d))); // B_i(R^T d_k)
    // Normal equations: (AᵀA) M = AᵀY  →  c' = M c.
    const AtA = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => A.reduce((s, row) => s + row[i] * row[j], 0)));
    const AtY = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => A.reduce((s, row, k) => s + row[i] * Y[k][j], 0)));
    out.push(solve(AtA, AtY));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Vertex transform                                                    */
/* ------------------------------------------------------------------ */

/** Number of SH bands stored in f_rest for K coefficients per channel. */
const SH_DEGREE_FOR_K: Record<number, number> = { 0: 0, 3: 1, 8: 2, 15: 3 };

interface VertexPlan {
  /** Property index for each scratch slot, or -1. */
  slots: number[];
  /** Mutates the scratch values in place. */
  apply(s: Float64Array): void;
}

// Scratch slot layout.
const S_POS = 0; // x y z
const S_NRM = 3; // nx ny nz
const S_ROT = 6; // rot_0..3 (w x y z)
const S_SCL = 10; // scale_0..2
const S_SH = 13; // f_rest_*

function planVertex(el: PlyElement, t: Similarity): VertexPlan {
  const byName = new Map(el.properties.map((p, i) => [p.name, i]));
  for (const p of el.properties) {
    if (p.listCountType && /^(x|y|z|nx|ny|nz|rot_\d|scale_\d|f_rest_\d+)$/.test(p.name)) {
      throw new Error(`PLY: vertex property "${p.name}" is a list`);
    }
  }
  const idx = (name: string) => byName.get(name) ?? -1;
  const restCount = el.properties.filter((p) => /^f_rest_\d+$/.test(p.name)).length;
  if (restCount % 3 !== 0 || !(restCount / 3 in SH_DEGREE_FOR_K)) {
    throw new Error(`PLY: ${restCount} f_rest properties is not a supported SH layout (expected 0, 9, 24 or 45)`);
  }
  const K = restCount / 3;
  const degree = SH_DEGREE_FOR_K[K];
  for (let i = 0; i < restCount; i++) {
    if (idx(`f_rest_${i}`) < 0) throw new Error(`PLY: missing f_rest_${i}`);
  }

  const slots = [
    idx('x'), idx('y'), idx('z'),
    idx('nx'), idx('ny'), idx('nz'),
    idx('rot_0'), idx('rot_1'), idx('rot_2'), idx('rot_3'),
    idx('scale_0'), idx('scale_1'), idx('scale_2'),
    ...Array.from({ length: restCount }, (_, i) => idx(`f_rest_${i}`)),
  ];
  const has = (a: number, n: number) => slots.slice(a, a + n).every((i) => i >= 0);
  const hasPos = has(S_POS, 3);
  const hasNrm = has(S_NRM, 3);
  const hasRot = has(S_ROT, 4);
  const hasScl = has(S_SCL, 3);
  if (!hasPos) throw new Error('PLY: vertex element has no x/y/z');
  // Only transform complete groups; leave partial ones untouched.
  if (!hasNrm) slots.fill(-1, S_NRM, S_NRM + 3);
  if (!hasRot) slots.fill(-1, S_ROT, S_ROT + 4);
  if (!hasScl) slots.fill(-1, S_SCL, S_SCL + 3);

  const R = quatToMatrix(t.rotation);
  const s = t.scale;
  const [tx, ty, tz] = t.translation;
  const logS = Math.log(s);
  const ql = Math.hypot(...t.rotation) || 1;
  const [rx, ry, rz, rw] = t.rotation.map((v) => v / ql);
  const shM = degree > 0 ? shRotationMatrices(t.rotation, degree) : [];
  const tmp = new Float64Array(7);

  return {
    slots,
    apply(v) {
      const x = v[0], y = v[1], z = v[2];
      v[0] = s * (R[0] * x + R[1] * y + R[2] * z) + tx;
      v[1] = s * (R[3] * x + R[4] * y + R[5] * z) + ty;
      v[2] = s * (R[6] * x + R[7] * y + R[8] * z) + tz;
      if (hasNrm) {
        const a = v[3], b = v[4], c = v[5];
        v[3] = R[0] * a + R[1] * b + R[2] * c;
        v[4] = R[3] * a + R[4] * b + R[5] * c;
        v[5] = R[6] * a + R[7] * b + R[8] * c;
      }
      if (hasRot) {
        let qw = v[6], qx = v[7], qy = v[8], qz = v[9];
        const l = Math.hypot(qw, qx, qy, qz);
        if (l > 0) {
          qw /= l; qx /= l; qy /= l; qz /= l;
        } else {
          qw = 1; qx = qy = qz = 0;
        }
        // Hamilton product R ⊗ q, stored back as (w, x, y, z).
        v[6] = rw * qw - rx * qx - ry * qy - rz * qz;
        v[7] = rw * qx + rx * qw + ry * qz - rz * qy;
        v[8] = rw * qy - rx * qz + ry * qw + rz * qx;
        v[9] = rw * qz + rx * qy - ry * qx + rz * qw;
      }
      if (hasScl) {
        v[10] += logS;
        v[11] += logS;
        v[12] += logS;
      }
      // f_rest is channel-major: f_rest_[c*K + i], i = SH index - 1.
      for (let c = 0; c < 3; c++) {
        const base = S_SH + c * K;
        let off = 0;
        for (let l = 1; l <= degree; l++) {
          const n = 2 * l + 1;
          const M = shM[l - 1];
          for (let i = 0; i < n; i++) {
            const row = M[i];
            let acc = 0;
            for (let j = 0; j < n; j++) acc += row[j] * v[base + off + j];
            tmp[i] = acc;
          }
          for (let i = 0; i < n; i++) v[base + off + i] = tmp[i];
          off += n;
        }
      }
    },
  };
}

type Getter = (dv: DataView, off: number, le: boolean) => number;
type Setter = (dv: DataView, off: number, v: number, le: boolean) => void;

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
const GET: Record<PlyScalarType, Getter> = {
  char: (d, o) => d.getInt8(o),
  uchar: (d, o) => d.getUint8(o),
  short: (d, o, le) => d.getInt16(o, le),
  ushort: (d, o, le) => d.getUint16(o, le),
  int: (d, o, le) => d.getInt32(o, le),
  uint: (d, o, le) => d.getUint32(o, le),
  float: (d, o, le) => d.getFloat32(o, le),
  double: (d, o, le) => d.getFloat64(o, le),
};
const SET: Record<PlyScalarType, Setter> = {
  char: (d, o, v) => d.setInt8(o, clampInt(v, -128, 127)),
  uchar: (d, o, v) => d.setUint8(o, clampInt(v, 0, 255)),
  short: (d, o, v, le) => d.setInt16(o, clampInt(v, -32768, 32767), le),
  ushort: (d, o, v, le) => d.setUint16(o, clampInt(v, 0, 65535), le),
  int: (d, o, v, le) => d.setInt32(o, clampInt(v, -2147483648, 2147483647), le),
  uint: (d, o, v, le) => d.setUint32(o, clampInt(v, 0, 4294967295), le),
  float: (d, o, v, le) => d.setFloat32(o, v, le),
  double: (d, o, v, le) => d.setFloat64(o, v, le),
};

/** Returns a function that transforms `n` packed binary vertices of `buf` in place. */
function binaryVertexTransformer(el: PlyElement, t: Similarity, le: boolean) {
  const plan = planVertex(el, t);
  const offsets: number[] = [];
  let o = 0;
  for (const p of el.properties) {
    offsets.push(o);
    o += PLY_TYPE_SIZE[p.type];
  }
  const stride = o;
  const active = plan.slots.map((pi, slot) => ({ slot, pi })).filter((a) => a.pi >= 0);
  const aSlot = active.map((a) => a.slot);
  const aOff = active.map((a) => offsets[a.pi]);
  const aGet = active.map((a) => GET[el.properties[a.pi].type]);
  const aSet = active.map((a) => SET[el.properties[a.pi].type]);
  const scratch = new Float64Array(plan.slots.length);
  return {
    stride,
    run(buf: Buffer, n: number) {
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      for (let v = 0, base = 0; v < n; v++, base += stride) {
        for (let k = 0; k < aSlot.length; k++) scratch[aSlot[k]] = aGet[k](dv, base + aOff[k], le);
        plan.apply(scratch);
        for (let k = 0; k < aSlot.length; k++) aSet[k](dv, base + aOff[k], scratch[aSlot[k]], le);
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export interface TransformPlyOptions {
  signal?: AbortSignal;
  /** Called with 0..1 as vertices are written. */
  onProgress?: (fraction: number) => void;
  /** Vertices per chunk for binary files (default 65 536). */
  chunkVertices?: number;
}

export interface TransformPlyResult {
  vertices: number;
  format: PlyFormat;
  shDegree: number;
}

function vertexElement(h: PlyHeader): { el: PlyElement; index: number } {
  const index = h.elements.findIndex((e) => e.name === 'vertex');
  if (index < 0) throw new Error('PLY: no vertex element');
  return { el: h.elements[index], index };
}

const shDegreeOf = (el: PlyElement) => SH_DEGREE_FOR_K[el.properties.filter((p) => /^f_rest_\d+$/.test(p.name)).length / 3] ?? 0;

/** Transform a PLY that is already in memory. Returns a new buffer. */
export function transformPlyBuffer(src: Buffer, t: Similarity): Buffer {
  const h = parsePlyHeader(src);
  if (h.format === 'ascii') return transformAscii(src, h, t);
  const { el, index } = vertexElement(h);
  let start = h.headerBytes;
  for (const e of h.elements.slice(0, index)) start += elementBytes(e);
  const tr = binaryVertexTransformer(el, t, h.format === 'binary_little_endian');
  const end = start + el.count * tr.stride;
  if (src.length < end) throw new Error('PLY: file is truncated');
  const out = Buffer.from(src);
  tr.run(out.subarray(start, end), el.count);
  return out;
}

function elementBytes(e: PlyElement): number {
  const s = fixedStride(e);
  if (!Number.isFinite(s)) throw new Error(`PLY: element "${e.name}" before the vertices has list properties (unsupported)`);
  return s * e.count;
}

/**
 * Stream `src` → `dest`, applying `t` to every Gaussian. `dest` is written
 * directly; callers wanting atomic replacement should write to a temp path
 * and rename.
 */
export async function transformPly(src: string, dest: string, t: Similarity, opts: TransformPlyOptions = {}): Promise<TransformPlyResult> {
  const h = await readPlyHeader(src);
  const { el, index } = vertexElement(h);
  const shDegree = shDegreeOf(el);
  if (h.format === 'ascii') {
    const out = transformAscii(await readFile(src), h, t);
    if (opts.signal?.aborted) throw new Error('cancelled');
    await writeFile(dest, out);
    opts.onProgress?.(1);
    return { vertices: el.count, format: h.format, shDegree };
  }

  const tr = binaryVertexTransformer(el, t, h.format === 'binary_little_endian');
  let vertexStart = h.headerBytes;
  for (const e of h.elements.slice(0, index)) vertexStart += elementBytes(e);
  const vertexEnd = vertexStart + el.count * tr.stride;

  const inp = await open(src, 'r');
  const out = await open(dest, 'w');
  try {
    const { size } = await inp.stat();
    if (size < vertexEnd) throw new Error(`PLY: file is truncated (${size} bytes, expected at least ${vertexEnd})`);
    const readExact = async (buf: Buffer, len: number, pos: number) => {
      let got = 0;
      while (got < len) {
        const { bytesRead } = await inp.read(buf, got, len - got, pos + got);
        if (bytesRead === 0) throw new Error('PLY: unexpected end of file');
        got += bytesRead;
      }
    };
    const copyRange = async (from: number, to: number) => {
      const buf = Buffer.allocUnsafe(Math.min(8 * 1024 * 1024, Math.max(1, to - from)));
      for (let pos = from; pos < to; ) {
        const len = Math.min(buf.length, to - pos);
        await readExact(buf, len, pos);
        await out.write(buf, 0, len);
        pos += len;
      }
    };

    // Header and any elements before the vertices, verbatim.
    await copyRange(0, vertexStart);

    const chunk = Math.max(1, opts.chunkVertices ?? 65536);
    const buf = Buffer.allocUnsafe(Math.min(chunk, Math.max(1, el.count)) * tr.stride);
    for (let v = 0; v < el.count; v += chunk) {
      if (opts.signal?.aborted) throw new Error('cancelled');
      const n = Math.min(chunk, el.count - v);
      const len = n * tr.stride;
      await readExact(buf, len, vertexStart + v * tr.stride);
      tr.run(buf, n);
      await out.write(buf, 0, len);
      opts.onProgress?.((v + n) / el.count);
    }

    // Everything after the vertices (faces, extra elements …), verbatim.
    await copyRange(vertexEnd, size);
  } finally {
    await inp.close();
    await out.close();
  }
  return { vertices: el.count, format: h.format, shDegree };
}

/* ------------------------------------------------------------------ */
/* ASCII                                                               */
/* ------------------------------------------------------------------ */

const fmtValue = (type: PlyScalarType, v: number) =>
  type === 'float' ? String(Number(Math.fround(v).toPrecision(9))) : type === 'double' ? String(v) : String(Math.round(v));

function transformAscii(src: Buffer, h: PlyHeader, t: Similarity): Buffer {
  const { el, index } = vertexElement(h);
  if (el.properties.some((p) => p.listCountType)) throw new Error('PLY: ASCII vertex element with list properties is not supported');
  const plan = planVertex(el, t);
  const active = plan.slots.map((pi, slot) => ({ slot, pi })).filter((a) => a.pi >= 0);
  const scratch = new Float64Array(plan.slots.length);

  const body = src.subarray(h.headerBytes).toString('latin1');
  const lines = body.split('\n');
  // Each element instance occupies one line (blank lines skipped).
  let li = 0;
  const nextLine = () => {
    while (li < lines.length && lines[li].trim() === '') li++;
    if (li >= lines.length) throw new Error('PLY: ASCII body ended early');
    return li++;
  };
  for (const e of h.elements.slice(0, index)) for (let i = 0; i < e.count; i++) nextLine();
  for (let i = 0; i < el.count; i++) {
    const at = nextLine();
    const cr = lines[at].endsWith('\r');
    const tok = lines[at].trim().split(/\s+/);
    if (tok.length < el.properties.length) throw new Error(`PLY: ASCII vertex ${i} has ${tok.length} values, expected ${el.properties.length}`);
    for (const a of active) scratch[a.slot] = Number(tok[a.pi]);
    plan.apply(scratch);
    for (const a of active) tok[a.pi] = fmtValue(el.properties[a.pi].type, scratch[a.slot]);
    lines[at] = tok.join(' ') + (cr ? '\r' : '');
  }
  return Buffer.concat([src.subarray(0, h.headerBytes), Buffer.from(lines.join('\n'), 'latin1')]);
}
