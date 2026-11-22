/**
 * Static data and pure helpers behind the browser mock (`mockApi.ts`):
 * stage descriptors, demo projects, canned stats, training curves and
 * system samples. No state here except the simulated GPU temperature.
 */
import type { PipelineSpec, ProjectMeta, RecentProject, StageDescriptor, SystemSample } from '@shared/api';
import { rng } from './assets';

const num = (o: Record<string, unknown>) => ({ type: 'number', ...o });
const int = (o: Record<string, unknown>) => ({ type: 'integer', ...o });
const bool = (o: Record<string, unknown>) => ({ type: 'boolean', ...o });
const en = (values: string[], o: Record<string, unknown>) => ({ type: 'string', enum: values, ...o });
const obj = (properties: Record<string, unknown>) => ({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties, additionalProperties: false });

export const STAGES: StageDescriptor[] = [
  {
    id: 'splatcraft.prepare.frames',
    version: '1.0.0',
    title: 'Extract frames',
    description: 'Decodes videos into stills and normalises photos (orientation, colour space, max resolution).',
    category: 'prepare',
    pluginId: 'splatcraft.builtin',
    tools: ['ffmpeg'],
    inputs: ['sources'],
    outputs: ['frames'],
    resumable: false,
    paramsJsonSchema: obj({
      fps: num({ minimum: 0.25, maximum: 10, default: 2, description: 'Frames per second sampled from videos.' }),
      maxFrames: int({ minimum: 20, maximum: 2000, default: 300, description: 'Upper bound on extracted frames across all sources.' }),
      maxResolution: int({ minimum: 512, maximum: 4096, default: 1600, description: 'Longest image side in pixels.' }),
      format: en(['jpg', 'png'], { default: 'jpg', description: 'Image format of extracted frames.' }),
    }),
    presets: { fast: { fps: 1, maxFrames: 120, maxResolution: 1080 }, balanced: {}, quality: { fps: 3, maxFrames: 600, maxResolution: 2400, format: 'png' } },
  },
  {
    id: 'splatcraft.filter.quality',
    version: '1.0.0',
    title: 'Quality filter',
    description: 'Scores sharpness and exposure and drops blurry, badly exposed or duplicate frames.',
    category: 'filter',
    pluginId: 'splatcraft.builtin',
    tools: [],
    inputs: ['frames'],
    outputs: ['frames'],
    resumable: false,
    paramsJsonSchema: obj({
      sharpnessThreshold: num({ minimum: 0, maximum: 1, default: 0.35, description: 'Frames with a normalised Laplacian variance below this are rejected.' }),
      dedupe: bool({ default: true, description: 'Remove near-identical consecutive frames.' }),
      exposureCheck: bool({ default: true, description: 'Reject heavily over- or under-exposed frames.' }),
      excluded: { type: 'array', items: { type: 'string' }, default: [], description: 'Frames manually excluded.' },
      included: { type: 'array', items: { type: 'string' }, default: [], description: 'Frames manually kept.' },
    }),
    presets: { fast: { sharpnessThreshold: 0.45 }, quality: { sharpnessThreshold: 0.25 } },
  },
  {
    id: 'splatcraft.align.colmap',
    version: '1.0.0',
    title: 'Align cameras',
    description: 'Structure-from-Motion with COLMAP (GLOMAP global mapper) to recover camera poses and a sparse point cloud.',
    category: 'align',
    pluginId: 'splatcraft.builtin',
    tools: ['colmap'],
    inputs: ['frames'],
    outputs: ['dataset'],
    resumable: false,
    paramsJsonSchema: obj({
      matcher: en(['sequential', 'exhaustive', 'vocab_tree'], { default: 'sequential', description: 'Feature matching strategy. Sequential suits video, exhaustive suits small photo sets.' }),
      mapper: en(['global', 'incremental'], { default: 'global', description: 'Global (GLOMAP) is much faster; incremental can be more robust.' }),
      maxFeatures: int({ minimum: 1024, maximum: 32768, default: 8192, description: 'SIFT features per image.' }),
      useGpu: bool({ default: true, description: 'Use the GPU for feature extraction and matching.' }),
      tiePoints: {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'integer' }, points: { type: 'array', items: { type: 'object', properties: { image: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } } } } },
        description: 'Feature points the user clicked (the same spot in several frames).',
      },
    }),
    presets: { fast: { maxFeatures: 4096 }, quality: { matcher: 'exhaustive', maxFeatures: 16384 } },
  },
  {
    id: 'splatcraft.train.brush',
    version: '1.0.0',
    title: 'Train splat',
    description: 'Trains a 3D Gaussian Splat with Brush (WebGPU — Metal, Vulkan, DX12).',
    category: 'train',
    pluginId: 'splatcraft.builtin',
    tools: ['brush'],
    inputs: ['dataset'],
    outputs: ['splat'],
    resumable: true,
    paramsJsonSchema: obj({
      steps: int({ minimum: 1000, maximum: 100000, default: 15000, description: 'Total optimisation steps.' }),
      maxSplats: int({ minimum: 100000, maximum: 10000000, default: 3000000, description: 'Upper bound on the number of gaussians.' }),
      shDegree: int({ minimum: 0, maximum: 3, default: 3, description: 'Spherical-harmonics degree for view-dependent colour.' }),
      lrScale: num({ minimum: 0.1, maximum: 4, default: 1, description: 'Global learning-rate multiplier.' }),
      previewEvery: int({ minimum: 100, maximum: 5000, default: 500, description: 'Write a live preview snapshot every N steps.' }),
      evalHoldout: bool({ default: true, description: 'Hold out every 8th view to report PSNR.' }),
    }),
    presets: { fast: { steps: 7000, maxSplats: 1000000, shDegree: 1 }, quality: { steps: 30000, maxSplats: 6000000 } },
  },
  {
    id: 'spirula.train',
    version: '0.4.0',
    title: 'Train splat (Spirula)',
    description: 'Spirula trainer with MCMC densification. Requires the Spirula add-on.',
    category: 'train',
    pluginId: 'spirula',
    tools: ['spirula'],
    inputs: ['dataset'],
    outputs: ['splat'],
    resumable: true,
    paramsJsonSchema: obj({
      steps: int({ minimum: 1000, maximum: 100000, default: 20000, description: 'Total optimisation steps.' }),
      capMax: int({ minimum: 100000, maximum: 10000000, default: 2000000, description: 'MCMC gaussian cap.' }),
      antialias: bool({ default: true, description: 'Mip-splatting style anti-aliasing.' }),
    }),
    presets: {},
  },
  {
    id: 'splatcraft.export.splat',
    version: '1.0.0',
    title: 'Edit & Export',
    description: 'Levels and scales the splat, then writes it in the chosen format(s).',
    category: 'export',
    pluginId: 'splatcraft.builtin',
    tools: [],
    inputs: ['splat'],
    outputs: ['export'],
    resumable: false,
    paramsJsonSchema: obj({
      format: en(['ply', 'spz', 'sog'], { default: 'spz', description: 'SPZ is ~10× smaller than PLY with minimal quality loss.' }),
      pruneOpacity: num({ minimum: 0, maximum: 0.5, default: 0.02, description: 'Drop gaussians below this opacity.' }),
      crop: bool({ default: false, description: 'Apply the crop box from the viewer.' }),
      alignment: { type: 'object', description: 'Ground plane and scale reference picked in the viewer.' },
    }),
    presets: {},
  },
];

const DEFAULT_SPEC: PipelineSpec = {
  preset: 'balanced',
  steps: [
    { key: 'frames', stageId: 'splatcraft.prepare.frames', enabled: true, params: {} },
    { key: 'quality', stageId: 'splatcraft.filter.quality', enabled: true, params: {} },
    { key: 'align', stageId: 'splatcraft.align.colmap', enabled: true, params: {} },
    { key: 'train', stageId: 'splatcraft.train.brush', enabled: true, params: {} },
    { key: 'export', stageId: 'splatcraft.export.splat', enabled: true, params: {} },
  ],
};

export const HOME = '/Users/demo';
export const days = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

export const RECENTS: RecentProject[] = [
  { dir: `${HOME}/Scans/Ceramic Vase.splatcraft`, name: 'Ceramic Vase', openedAt: days(0.1), exists: true },
  { dir: `${HOME}/Scans/Courtyard Fountain.splatcraft`, name: 'Courtyard Fountain', openedAt: days(1.2), exists: true },
  { dir: `${HOME}/Projects/Client/Lobby Walkthrough.splatcraft`, name: 'Lobby Walkthrough', openedAt: days(3), exists: true },
  { dir: '/Volumes/Archive/Old Bike.splatcraft', name: 'Old Bike', openedAt: days(9), exists: false },
  { dir: `${HOME}/Scans/Garden Bench.splatcraft`, name: 'Garden Bench', openedAt: days(21), exists: true },
];

export function makeMeta(name: string, dir: string, withSources: boolean): ProjectMeta {
  const sources: ProjectMeta['sources'] = [];
  if (withSources) {
    sources.push({ id: 's1', path: 'sources/IMG_4021.MOV', mode: 'copy', kind: 'video', name: 'IMG_4021.MOV', size: 412_000_000, mtimeMs: Date.now(), addedAt: days(0.2) });
    sources.push({ id: 's2', path: 'sources/IMG_4022.MOV', mode: 'copy', kind: 'video', name: 'IMG_4022.MOV', size: 188_000_000, mtimeMs: Date.now(), addedAt: days(0.2) });
    for (let i = 0; i < 6; i++) {
      const n = `DSC0${1180 + i}.JPG`;
      sources.push({ id: `p${i}`, path: `sources/${n}`, mode: 'copy', kind: 'image', name: n, size: 8_400_000 + i * 120_000, mtimeMs: Date.now(), addedAt: days(0.2) });
    }
  }
  return {
    schemaVersion: 1,
    id: Math.random().toString(36).slice(2),
    name,
    description: withSources ? 'Glazed vase on a stone plinth, turntable + handheld orbit.' : '',
    tags: withSources ? ['object', 'turntable'] : [],
    createdAt: days(2),
    updatedAt: days(0.1),
    capture: withSources ? { date: '2026-11-14', location: 'Studio B', device: 'iPhone 17 Pro', notes: '' } : {},
    sources,
    pipeline: structuredClone(DEFAULT_SPEC),
  };
}


/* ------------------------------------------------------------------ */

/** What the mock file picker "selects". */
export const MOCK_PICK = ['/Users/demo/Desktop/IMG_5001.MOV', '/Users/demo/Desktop/IMG_5002.JPG', '/Users/demo/Desktop/IMG_5003.JPG'];

export function mockKind(name: string): 'image' | 'video' | 'other' {
  if (/\.(mov|mp4|m4v|avi|mkv|webm)$/i.test(name)) return 'video';
  return /\.(jpe?g|png|heic|tiff?|dng|webp)$/i.test(name) ? 'image' : 'other';
}

export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function cannedStats(key: string): Record<string, number | string> | undefined {
  switch (key) {
    case 'frames':
      return { frames: 72, fromPhotos: 0, fromVideos: 72, videos: 2 };
    case 'quality':
      return { frames: 72, kept: 62, rejected: 10 };
    case 'align':
      return { registered: '62/62', registeredImages: 62, totalImages: 62, points: 12000, reprojErrorPx: 0.61 };
    case 'train':
      return { steps: 15000, splats: 1_842_113, psnr: 29.4 };
    case 'export':
      return { file: 'exports/scene.spz', sizeMB: 41.2 };
  }
  return undefined;
}

export function curveAt(s: number, total: number, r: () => number) {
  const f = s / total;
  const noise = (k: number) => (r() - 0.5) * k;
  return {
    loss: 0.018 + 0.16 * Math.exp(-s / 1400) + 0.012 * Math.exp(-s / 9000) + noise(0.006),
    psnr: 14 + 15.6 * (1 - Math.exp(-s / 2600)) + noise(0.5),
    splats: Math.min(1_850_000, 120_000 + 1_900_000 * Math.min(1, s / Math.min(total * 0.55, 8000))) * (1 + noise(0.004)),
    stepsPerSec: 38 - 11 * Math.min(1, f * 1.6) + noise(2.4),
  };
}

export function fakeTrainingCurve(total: number, seed: number) {
  const r = rng(seed);
  const out: { key: string; step: number; values: Record<string, number> }[] = [];
  for (let s = 100; s <= total; s += 100) out.push({ key: 'train', step: s, values: curveAt(s, 15000, r) });
  return out;
}

let gpuTemp = 46;
export function sample(t: number, load: number): SystemSample {
  const w = Math.sin(t / 9000) * 0.5 + 0.5;
  const util = load ? 88 + Math.random() * 10 : 3 + Math.random() * 6;
  gpuTemp += ((load ? 74 : 45) - gpuTemp) * 0.06;
  return {
    t,
    cpu: { utilization: (load ? 34 : 9) + Math.random() * 10 + w * 6, cores: 16, model: 'AMD Ryzen 9 7950X' },
    memory: { usedMB: (load ? 31_000 : 21_500) + w * 1200, totalMB: 65_536 },
    disk: { freeMB: 412_000 - (load ? 2000 : 0), totalMB: 1_907_000, path: '/Users/demo/Scans' },
    gpus: [
      {
        name: 'NVIDIA GeForce RTX 4090',
        vendor: 'nvidia',
        utilization: util,
        vramUsedMB: load ? 19_800 + w * 2100 : 1_350 + w * 200,
        vramTotalMB: 24_564,
        temperatureC: gpuTemp + Math.random(),
        powerW: load ? 380 + Math.random() * 40 : 28 + Math.random() * 6,
      },
    ],
  };
}
