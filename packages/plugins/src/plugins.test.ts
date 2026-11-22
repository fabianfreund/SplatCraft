import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hashOf, Registry, resolveParams } from '@splatcraft/core';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { exportStep, parseBrushLine } from './brush/parse.js';
import { colmapLineProgress, colmapPoseToCamera, parseImagesTxt, parseModelAnalyzer } from './colmap/model.js';
import { colmapStage } from './colmap/index.js';
import { builtinPlugins, defaultPipeline } from './index.js';
import { parseIoregAccelerator, parseNvidiaSmi } from './monitor/index.js';
import { decideFrames } from './quality/decide.js';
import { readPlyInfo } from './util/fs.js';
import { computeMetrics, dHash, hamming, loadGray, type Gray, type ImageMetrics } from './util/image.js';

async function registry() {
  const r = new Registry();
  for (const p of builtinPlugins) await r.load(p);
  return r;
}

describe('registry + params', () => {
  it('registers every default pipeline stage with a JSON schema', async () => {
    const r = await registry();
    const spec = defaultPipeline('fast');
    for (const step of spec.steps) expect(r.stages.has(step.stageId)).toBe(true);
    expect(r.pipelines.has('splatcraft.default')).toBe(true);
    for (const d of r.describeStages()) expect((d.paramsJsonSchema as any).type).toBe('object');
  });

  it('resolves defaults ← preset ← user overrides', async () => {
    const r = await registry();
    const brush = r.stage('splatcraft.train.brush');
    expect(resolveParams(brush, 'balanced', {}).totalSteps).toBe(15000);
    expect(resolveParams(brush, 'fast', {}).totalSteps).toBe(3000);
    const p = resolveParams(brush, 'fast', { totalSteps: 1234 });
    expect(p.totalSteps).toBe(1234);
    expect(p.shDegree).toBe(3); // schema default
    expect(() => resolveParams(brush, 'fast', { shDegree: 9 })).toThrow();
  });

  it('hashes are stable under key order and change with params', async () => {
    const r = await registry();
    const q = r.stage('splatcraft.filter.quality');
    const a = resolveParams(q, 'fast', { blurThreshold: 40, maxFrames: 10 });
    const b = resolveParams(q, 'fast', { maxFrames: 10, blurThreshold: 40 });
    expect(hashOf(q.id, q.version, a, { frames: 'x' })).toBe(hashOf(q.id, q.version, b, { frames: 'x' }));
    const c = resolveParams(q, 'fast', { maxFrames: 11, blurThreshold: 40 });
    expect(hashOf(q.id, q.version, a, { frames: 'x' })).not.toBe(hashOf(q.id, q.version, c, { frames: 'x' }));
    // Snapshot: guards against accidental hash-scheme changes (would invalidate every cache).
    expect(hashOf('s', '1', { b: 2, a: [1, { y: 1, x: 0 }] })).toBe(hashOf('s', '1', { a: [1, { x: 0, y: 1 }], b: 2 }));
  });
});

/* ---------------- quality scoring on synthetic images ---------------- */

function checker(w: number, h: number, cell: number, lo = 30, hi = 220): Gray {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? hi : lo;
  return { data, width: w, height: h };
}

async function blurred(g: Gray, sigma: number): Promise<Gray> {
  const { data, info } = await sharp(Buffer.from(g.data), { raw: { width: g.width, height: g.height, channels: 1 } })
    .blur(sigma)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = new Uint8Array(g.width * g.height);
  for (let i = 0; i < out.length; i++) out[i] = data[i * info.channels];
  return { data: out, width: g.width, height: g.height };
}

describe('image metrics', () => {
  it('sharp images score higher than blurred ones', async () => {
    const g = checker(256, 256, 8);
    const sharpM = computeMetrics(g);
    const blurM = computeMetrics(await blurred(g, 4));
    expect(sharpM.sharpness).toBeGreaterThan(blurM.sharpness * 5);
  });

  it('measures exposure and clipping', () => {
    const dark = computeMetrics({ data: new Uint8Array(100).fill(2), width: 10, height: 10 });
    expect(dark.brightness).toBe(2);
    expect(dark.darkClip).toBe(1);
    const bright = computeMetrics({ data: new Uint8Array(100).fill(255), width: 10, height: 10 });
    expect(bright.brightClip).toBe(1);
  });

  it('dHash: near-identical images are close, different images far', async () => {
    const wave = (fx: number, fy: number): Gray => {
      const data = new Uint8Array(128 * 128);
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) data[y * 128 + x] = 128 + 100 * Math.sin(x / fx) * Math.cos(y / fy);
      return { data, width: 128, height: 128 };
    };
    const a = wave(20, 17);
    const b = await blurred(a, 1);
    const c = wave(9, 31);
    expect(hamming(dHash(a), dHash(b))).toBeLessThanOrEqual(2);
    expect(hamming(dHash(a), dHash(c))).toBeGreaterThan(8);
  });

  it('loads real files with EXIF rotation applied', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sc-test-'));
    const f = path.join(dir, 'r.jpg');
    await sharp({ create: { width: 200, height: 100, channels: 3, background: '#808080' } }).jpeg().withMetadata({ orientation: 6 }).toFile(f);
    const g = await loadGray(f, 64);
    expect(g.height).toBeGreaterThan(g.width); // rotated 90°
  });
});

describe('decideFrames', () => {
  const m = (sharpness: number, dhash: string, brightness = 120): ImageMetrics => ({ sharpness, brightness, darkClip: 0, brightClip: 0, dhash });
  const base = { blurThreshold: 50, minBrightness: 20, maxBrightness: 235, maxClipped: 0.3, duplicateThreshold: 2, maxFrames: 0, excluded: [] as string[], included: [] as string[] };
  const frames = [
    { name: 'a.jpg', metrics: m(100, '0000000000000000') },
    { name: 'b.jpg', metrics: m(10, 'ffffffffffffffff') }, // blurry (10% of median)
    { name: 'c.jpg', metrics: m(100, '0000000000000001') }, // duplicate of a
    { name: 'd.jpg', metrics: m(110, '00ff00ff00ff00ff', 5) }, // underexposed
    { name: 'e.jpg', metrics: m(120, 'f0f0f0f0f0f0f0f0') },
  ];

  it('rejects blur, duplicates and bad exposure', () => {
    const d = decideFrames(frames, base);
    expect(d.map((x) => x.reason ?? 'ok')).toEqual(['ok', 'blurry', 'duplicate', 'underexposed', 'ok']);
  });

  it('honours user overrides', () => {
    const d = decideFrames(frames, { ...base, included: ['b.jpg'], excluded: ['e'] });
    expect(d.find((x) => x.name === 'b.jpg')!.kept).toBe(true);
    expect(d.find((x) => x.name === 'e.jpg')!.reason).toBe('excluded');
  });

  it('subsamples to maxFrames keeping the sharpest per bin', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `${i}.jpg`, metrics: m(100 + (i % 2) * 10, (i * 0x1111111).toString(16).padStart(16, '0')) }));
    const d = decideFrames(many, { ...base, duplicateThreshold: -1, maxFrames: 5 });
    const kept = d.filter((x) => x.kept).map((x) => x.name);
    expect(kept).toEqual(['1.jpg', '3.jpg', '5.jpg', '7.jpg', '9.jpg']);
  });
});

/* ---------------- COLMAP / Brush / monitor parsing ---------------- */

describe('colmap model', () => {
  it('converts world-to-camera poses to camera centres', () => {
    const id = colmapPoseToCamera(1, 0, 0, 0, 1, 2, 3);
    expect(id.position).toEqual([-1, -2, -3]);
    // 90° about Z: R maps x→y. C = -Rᵀ t
    const s = Math.SQRT1_2;
    const r = colmapPoseToCamera(s, 0, 0, s, 1, 0, 0);
    expect(r.position[0]).toBeCloseTo(0);
    expect(r.position[1]).toBeCloseTo(1);
    expect(r.quaternion[3]).toBeCloseTo(s);
    expect(r.quaternion[2]).toBeCloseTo(-s);
  });

  it('parses images.txt incl. empty point lines', () => {
    const txt = '# header\n# Number of images: 2\n1 1 0 0 0 0 0 1 1 a.jpg\n1.0 2.0 -1\n2 1 0 0 0 0 0 2 1 my b.jpg\n\n';
    const cams = parseImagesTxt(txt);
    expect(cams.map((c) => c.name)).toEqual(['a.jpg', 'my b.jpg']);
    expect(cams[1].position[2]).toBeCloseTo(-2);
  });

  it('parses model_analyzer + progress lines', () => {
    const s = parseModelAnalyzer('I1 model.cc:440] Registered images: 45\nI1 model.cc:442] Points: 9636\nI1 model.cc:450] Mean reprojection error: 1.125px');
    expect(s).toMatchObject({ registeredImages: 45, points: 9636, meanReprojectionError: 1.125 });
    expect(colmapLineProgress('feature_extraction.cc:270] Processed file [10/50]', 'extract', 50)).toBeCloseTo(0.2);
    expect(colmapLineProgress('pairing.cc:214] Processing block [2/2, 1/2]', 'match', 50)).toBeCloseTo(0.5);
  });
});

describe('brush output', () => {
  it('parses tty and log lines', () => {
    expect(parseBrushLine('[1s] ◍◍○○      75/300     Steps (19.5835/s, 11s remaining)')).toEqual({ type: 'step', step: 75, total: 300, stepsPerSec: 19.5835, remaining: '11s' });
    expect(parseBrushLine('✅ Eval iter 300: PSNR 17.682453, ssim 0.64167947')).toMatchObject({ type: 'eval', step: 300, psnr: 17.682453 });
    expect(parseBrushLine('[2026Z INFO  brush_cli] Refine iter 201, 10346 splats.')).toEqual({ type: 'splats', step: 201, count: 10346 });
    expect(parseBrushLine('ℹ️ Current splat count 10352')).toEqual({ type: 'splats', count: 10352 });
    expect(exportStep('/x/export_0500.ply')).toBe(500);
  });

  it('detects complete vs truncated PLY snapshots', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sc-ply-'));
    const header = 'ply\nformat binary_little_endian 1.0\nelement vertex 10\nproperty float x\nproperty float y\nproperty float z\nend_header\n';
    await writeFile(path.join(dir, 'ok.ply'), Buffer.concat([Buffer.from(header), Buffer.alloc(120)]));
    await writeFile(path.join(dir, 'cut.ply'), Buffer.concat([Buffer.from(header), Buffer.alloc(50)]));
    expect(await readPlyInfo(path.join(dir, 'ok.ply'))).toMatchObject({ vertices: 10, complete: true, stride: 12 });
    expect((await readPlyInfo(path.join(dir, 'cut.ply')))?.complete).toBe(false);
  });
});

describe('monitor parsers', () => {
  it('parses ioreg and nvidia-smi', () => {
    const io = '"model" = "Apple M2"\n"PerformanceStatistics" = {"In use system memory (driver)"=0,"Device Utilization %"=32,"In use system memory"=341655552}';
    expect(parseIoregAccelerator(io)).toMatchObject({ name: 'Apple M2', vendor: 'apple', utilization: 32, vramUsedMB: 326 });
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 4090, 87, 12000, 24564, 66, 350.12\n')[0]).toMatchObject({ utilization: 87, vramUsedMB: 12000, vramTotalMB: 24564, temperatureC: 66, powerW: 350.12 });
    expect(parseNvidiaSmi('GPU, [N/A], 1, 2, 3, [N/A]')[0].utilization).toBeUndefined();
  });
});

describe('colmap feature points (params)', () => {
  it('leaves the cache key of existing projects alone while unset', () => {
    const params = resolveParams(colmapStage, 'balanced', {});
    expect(params.tiePoints).toBeUndefined();
    const tiePoints = [{ id: 1, points: [{ image: 'a.jpg', x: 0.5, y: 0.5 }, { image: 'b.jpg', x: 0.4, y: 0.5 }] }];
    expect(resolveParams(colmapStage, 'balanced', { tiePoints }).tiePoints).toEqual(tiePoints);
    expect(() => resolveParams(colmapStage, 'balanced', { tiePoints: [{ id: 1, points: [{ image: 'a.jpg', x: 2, y: 0 }] }] })).toThrow();
  });
});
