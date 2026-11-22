/**
 * Camera detection before alignment: which frames share a lens (intrinsics), and
 * which have a focal-length prior.
 *
 * - Photos with camera EXIF: grouped by body + lens + focal length + size. COLMAP
 *   reads the EXIF focal length itself and uses it as a prior.
 * - Frames from one video (`<stem>_00001.jpg`, see the media stage): one camera per video and size.
 * - Photos without lens data (downloads, edits, screenshots): one camera each, so
 *   unrelated lenses are never forced to share intrinsics.
 */
import path from 'node:path';
import exifReader from 'exif-reader';
import sharp from 'sharp';

export interface FrameCamera {
  file: string;
  kind: 'exif' | 'video' | 'photo';
  /** Frames with the same key share one camera (empty for `photo`: its own camera). */
  key: string;
  /** EXIF focal length present (COLMAP gets a prior). */
  focal: boolean;
  /** Short human label, e.g. "Apple iPhone 15 Pro · 24 mm". */
  label: string;
}

export interface CameraGroup {
  /** Frames sharing intrinsics (one COLMAP camera), or `individual` = one camera per frame. */
  shared: boolean;
  label: string;
  files: string[];
  focal: boolean;
}

const VIDEO_FRAME = /^(.*)_\d{5}$/;

interface Exif {
  Image?: { Make?: string; Model?: string };
  Photo?: { LensModel?: string; FocalLength?: number; FocalLengthIn35mmFilm?: number };
}

/** Pure classification of one frame from its name, size and parsed EXIF. */
export function classifyFrame(file: string, width: number | undefined, height: number | undefined, exif: Exif | undefined): FrameCamera {
  const size = width && height ? `${width}×${height}` : 'unknown';
  const make = exif?.Image?.Make?.trim();
  const model = exif?.Image?.Model?.trim();
  const lens = exif?.Photo?.LensModel?.trim();
  const f = exif?.Photo?.FocalLength;
  const f35 = exif?.Photo?.FocalLengthIn35mmFilm;
  const focal = (typeof f === 'number' && f > 0) || (typeof f35 === 'number' && f35 > 0);
  if (make || model || focal) {
    // "Canon" + "Canon EOS R5" → "Canon EOS R5"
    const body = (make && model?.toLowerCase().startsWith(make.toLowerCase()) ? model : [make, model].filter(Boolean).join(' ')) || 'Camera';
    const mm = f35 ? `${Math.round(f35)} mm` : f ? `${+f.toFixed(1)} mm` : undefined;
    return { file, kind: 'exif', key: ['exif', make, model, lens, f, f35, size].join('|'), focal, label: [body, mm].filter(Boolean).join(' · ') };
  }
  const stem = path.parse(file).name;
  const video = VIDEO_FRAME.exec(stem);
  if (video) return { file, kind: 'video', key: `video|${video[1]}|${size}`, focal: false, label: `${video[1]} (video)` };
  return { file, kind: 'photo', key: '', focal: false, label: 'No lens data' };
}

/** Groups classified frames: shared cameras first (largest first), then all individual photos. */
export function groupCameras(frames: readonly FrameCamera[]): CameraGroup[] {
  const shared = new Map<string, CameraGroup>();
  const individual: string[] = [];
  for (const f of frames) {
    if (!f.key) {
      individual.push(f.file);
      continue;
    }
    const g = shared.get(f.key) ?? { shared: true, label: f.label, files: [], focal: f.focal };
    g.files.push(f.file);
    shared.set(f.key, g);
  }
  const out = [...shared.values()].sort((a, b) => b.files.length - a.files.length);
  if (individual.length) out.push({ shared: false, label: 'No lens data', files: individual, focal: false });
  return out;
}

/** One camera per frame ("single camera" off), split by focal prior so the counts stay right. */
export function perImageGroups(frames: readonly FrameCamera[]): CameraGroup[] {
  const withFocal = frames.filter((f) => f.focal).map((f) => f.file);
  const without = frames.filter((f) => !f.focal).map((f) => f.file);
  return [
    ...(withFocal.length ? [{ shared: false, label: 'Per image (lens data)', files: withFocal, focal: true }] : []),
    ...(without.length ? [{ shared: false, label: 'Per image', files: without, focal: false }] : []),
  ];
}

/** Number of COLMAP cameras the groups produce, and how many have a focal prior. */
export function cameraCounts(groups: readonly CameraGroup[]) {
  let cameras = 0;
  let withFocal = 0;
  for (const g of groups) {
    const n = g.shared ? 1 : g.files.length;
    cameras += n;
    if (g.focal) withFocal += n;
  }
  return { cameras, withFocal };
}

/** Reads size + EXIF of each frame and classifies it. */
export async function detectCameras(files: readonly string[]): Promise<FrameCamera[]> {
  return Promise.all(
    files.map(async (file) => {
      const m = await sharp(file).metadata().catch(() => undefined);
      let exif: Exif | undefined;
      try {
        exif = m?.exif ? (exifReader(m.exif) as Exif) : undefined;
      } catch {
        exif = undefined;
      }
      return classifyFrame(file, m?.width, m?.height, exif);
    }),
  );
}
