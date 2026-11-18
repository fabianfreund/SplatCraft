/**
 * Procedural stand-ins for real pipeline outputs, used ONLY by the browser
 * mock API: frame thumbnails, a sparse point cloud and gaussian splat PLYs.
 */

/* ---------- deterministic RNG ---------- */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}
function gauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
}

/* ---------- scene: a ceramic vase on a mossy stone plinth ---------- */
interface P {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
}

/** Points in COLMAP convention (y down). */
function scenePoints(n: number, seed: number, noise: number): P[] {
  const r = rng(seed);
  const out: P[] = [];
  for (let i = 0; i < n; i++) {
    const u = r();
    let p: P;
    if (u < 0.42) {
      // vase body: surface of revolution
      const t = r();
      const a = r() * Math.PI * 2;
      const h = t * 1.6;
      const rad = 0.18 + 0.32 * Math.sin(Math.PI * Math.pow(t, 0.85)) + 0.06 * Math.cos(t * 9);
      const band = Math.sin(t * 22) > 0.55;
      const glaze = 0.5 + 0.5 * Math.sin(a * 3 + t * 5);
      p = {
        x: Math.cos(a) * rad,
        y: -(h + 0.35),
        z: Math.sin(a) * rad,
        r: band ? 0.93 : 0.12 + 0.1 * glaze,
        g: band ? 0.78 : 0.42 + 0.2 * glaze,
        b: band ? 0.42 : 0.55 + 0.15 * glaze,
      };
    } else if (u < 0.62) {
      // plinth (box)
      const face = Math.floor(r() * 3);
      const s = 0.75;
      const x = (r() * 2 - 1) * s;
      const z = (r() * 2 - 1) * s;
      const y = -r() * 0.35;
      const g = 0.38 + r() * 0.1;
      if (face === 0) p = { x, y: -0.35, z, r: g + 0.05, g: g + 0.08, b: g };
      else if (face === 1) p = { x: Math.sign(x) * s, y, z, r: g, g, b: g - 0.03 };
      else p = { x, y, z: Math.sign(z) * s, r: g, g, b: g - 0.03 };
      if (r() < 0.25) {
        p.r = 0.25;
        p.g = 0.45 + r() * 0.15;
        p.b = 0.18;
      }
    } else {
      // ground: warm floor fading out
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 3.2;
      const tile = (Math.floor((Math.cos(a) * d + 4) * 2) + Math.floor((Math.sin(a) * d + 4) * 2)) % 2;
      const k = 0.55 - d * 0.08;
      p = { x: Math.cos(a) * d, y: 0, z: Math.sin(a) * d, r: k * (tile ? 0.95 : 0.78), g: k * (tile ? 0.8 : 0.64), b: k * (tile ? 0.62 : 0.5) };
    }
    p.x += gauss(r) * noise;
    p.y += gauss(r) * noise;
    p.z += gauss(r) * noise;
    out.push(p);
  }
  return out;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Binary PLY in the standard 3DGS layout. `quality` 0..1 sharpens. */
export function makeSplatPly(n: number, quality: number, seed = 7): Blob {
  const pts = scenePoints(n, seed, 0.03 * (1 - quality) + 0.003);
  const props = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const header =
    `ply\nformat binary_little_endian 1.0\nelement vertex ${n}\n` + props.map((p) => `property float ${p}\n`).join('') + 'end_header\n';
  const head = new TextEncoder().encode(header);
  const buf = new ArrayBuffer(n * props.length * 4);
  const dv = new DataView(buf);
  const r = rng(seed + 99);
  const C0 = 0.28209479177387814;
  const base = Math.log(0.05 * (1 - quality) + 0.012);
  let o = 0;
  const w = (v: number) => {
    dv.setFloat32(o, v, true);
    o += 4;
  };
  for (const p of pts) {
    const jitter = 0.06 * (1 - quality);
    w(p.x);
    w(p.y);
    w(p.z);
    w((clamp01(p.r + gauss(r) * jitter) - 0.5) / C0);
    w((clamp01(p.g + gauss(r) * jitter) - 0.5) / C0);
    w((clamp01(p.b + gauss(r) * jitter) - 0.5) / C0);
    w(2.2 + quality * 2); // logit opacity
    w(base + gauss(r) * 0.25);
    w(base + gauss(r) * 0.25);
    w(base + gauss(r) * 0.25 - 0.4);
    const q = [r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5];
    const l = Math.hypot(...q) || 1;
    q.forEach((c) => w(c / l));
  }
  return new Blob([head, buf], { type: 'application/octet-stream' });
}

/** Sparse SfM-style point cloud with uchar colors. */
export function makePointCloudPly(n: number, seed = 3): Blob {
  const pts = scenePoints(n, seed, 0.012);
  const header =
    `ply\nformat binary_little_endian 1.0\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
  const head = new TextEncoder().encode(header);
  const buf = new ArrayBuffer(n * 15);
  const dv = new DataView(buf);
  let o = 0;
  for (const p of pts) {
    dv.setFloat32(o, p.x, true);
    dv.setFloat32(o + 4, p.y, true);
    dv.setFloat32(o + 8, p.z, true);
    dv.setUint8(o + 12, Math.round(clamp01(p.r) * 255));
    dv.setUint8(o + 13, Math.round(clamp01(p.g) * 255));
    dv.setUint8(o + 14, Math.round(clamp01(p.b) * 255));
    o += 15;
  }
  return new Blob([head, buf], { type: 'application/octet-stream' });
}

/** Camera ring around the vase, looking at it (OpenCV axes, y down world). */
export function makeCameraRing(n: number) {
  const cams: { name: string; position: [number, number, number]; quaternion: [number, number, number, number] }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ring = i % 2 ? 2.6 : 2.9;
    const pos: [number, number, number] = [Math.cos(a) * ring, -1.3 - (i % 3) * 0.35, Math.sin(a) * ring];
    // forward = target - pos
    const t = [0, -0.9, 0];
    const f = norm([t[0] - pos[0], t[1] - pos[1], t[2] - pos[2]]);
    const down = [0, 1, 0];
    const right = norm(cross(down, f) as [number, number, number]);
    const y = cross(f, right) as [number, number, number];
    cams.push({ name: `frame_${String(i + 1).padStart(4, '0')}.jpg`, position: pos, quaternion: quatFromBasis(right, y, f) });
  }
  return cams;
}
function norm(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a: number[], b: number[]) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function quatFromBasis(x: number[], y: number[], z: number[]): [number, number, number, number] {
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

/** A small "photo" of the vase from angle i. */
export function makeFrameImage(i: number, total: number, opts: { blur?: number; exposure?: number } = {}): string {
  const W = 240;
  const H = 160;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const a = (i / total) * Math.PI * 2;
  if (opts.blur) ctx.filter = `blur(${opts.blur}px)`;
  const wall = ctx.createLinearGradient(0, 0, 0, H);
  wall.addColorStop(0, '#2b2f36');
  wall.addColorStop(0.62, '#3c3a37');
  wall.addColorStop(0.63, '#6b5843');
  wall.addColorStop(1, '#3d3127');
  ctx.fillStyle = wall;
  ctx.fillRect(-10, -10, W + 20, H + 20);
  const cx = W / 2 + Math.sin(a) * 26;
  // window light
  ctx.fillStyle = 'rgba(255,240,210,0.08)';
  ctx.fillRect(20 + Math.cos(a) * 60, 12, 46, 70);
  // plinth
  ctx.fillStyle = '#5c5f5a';
  ctx.fillRect(cx - 52, 104, 104, 40);
  ctx.fillStyle = '#707369';
  ctx.beginPath();
  ctx.moveTo(cx - 52, 104);
  ctx.lineTo(cx + 52, 104);
  ctx.lineTo(cx + 42 + Math.cos(a) * 8, 96);
  ctx.lineTo(cx - 62 + Math.cos(a) * 8, 96);
  ctx.closePath();
  ctx.fill();
  // vase
  const g = ctx.createLinearGradient(cx - 30, 0, cx + 30, 0);
  g.addColorStop(0, '#1d4f5e');
  g.addColorStop(0.45 + Math.sin(a) * 0.2, '#4aa3a8');
  g.addColorStop(1, '#173a46');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - 10, 26);
  ctx.bezierCurveTo(cx - 40, 50, cx - 42, 86, cx - 16, 100);
  ctx.lineTo(cx + 16, 100);
  ctx.bezierCurveTo(cx + 42, 86, cx + 40, 50, cx + 10, 26);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e6c06a';
  ctx.fillRect(cx - 31, 58, 62, 4);
  ctx.fillRect(cx - 27, 76, 54, 3);
  ctx.filter = 'none';
  if (opts.exposure) {
    ctx.fillStyle = opts.exposure > 0 ? `rgba(255,250,240,${opts.exposure})` : `rgba(0,0,0,${-opts.exposure})`;
    ctx.fillRect(0, 0, W, H);
  }
  return c.toDataURL('image/jpeg', 0.82);
}
