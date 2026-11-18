import sharp from 'sharp';

/** 8-bit grayscale image in row-major order. */
export interface Gray {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface ImageMetrics {
  /** Variance of the 4-neighbour Laplacian (higher = sharper). */
  sharpness: number;
  /** Mean luminance 0..255. */
  brightness: number;
  /** Fraction of pixels ≤ 3 (crushed blacks). */
  darkClip: number;
  /** Fraction of pixels ≥ 252 (blown highlights). */
  brightClip: number;
  /** 64-bit difference hash as 16 hex chars. */
  dhash: string;
}

/** Load an image as a downscaled grayscale buffer (EXIF rotation applied). */
export async function loadGray(file: string, maxSide = 512): Promise<Gray> {
  const { data, info } = await sharp(file, { failOn: 'none' })
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true, kernel: 'linear' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // greyscale() may still yield >1 channel for some inputs; take the first.
  if (info.channels === 1) return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
  const out = new Uint8Array(info.width * info.height);
  for (let i = 0; i < out.length; i++) out[i] = data[i * info.channels];
  return { data: out, width: info.width, height: info.height };
}

export function laplacianVariance(g: Gray): number {
  const { data, width: w, height: h } = g;
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = row + x;
      const v = data[i - w] + data[i + w] + data[i - 1] + data[i + 1] - 4 * data[i];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export function exposureStats(g: Gray) {
  let sum = 0;
  let dark = 0;
  let bright = 0;
  for (const v of g.data) {
    sum += v;
    if (v <= 3) dark++;
    else if (v >= 252) bright++;
  }
  const n = g.data.length || 1;
  return { brightness: sum / n, darkClip: dark / n, brightClip: bright / n };
}

/** Box-resample to w×h (area average). */
export function resampleBox(g: Gray, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * g.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * g.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * g.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * g.width) / w));
      let s = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) s += g.data[yy * g.width + xx];
      out[y * w + x] = s / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

/** Difference hash: 9×8 grid, one bit per horizontal neighbour comparison. */
export function dHash(g: Gray): string {
  const px = resampleBox(g, 9, 8);
  let hex = '';
  for (let y = 0; y < 8; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1 : 0);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export function computeMetrics(g: Gray): ImageMetrics {
  return { sharpness: laplacianVariance(g), ...exposureStats(g), dhash: dHash(g) };
}

export async function analyzeImage(file: string, maxSide = 512): Promise<ImageMetrics> {
  return computeMetrics(await loadGray(file, maxSide));
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
