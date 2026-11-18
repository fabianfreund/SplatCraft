/** Pure helpers for COLMAP text models and logs (unit-testable, no I/O). */

export interface CameraPose {
  name: string;
  /** Camera centre in world coordinates (COLMAP world frame). */
  position: [number, number, number];
  /**
   * Camera-to-world rotation as quaternion [x, y, z, w] (three.js order).
   * Camera axes follow COLMAP/OpenCV: +X right, +Y down, +Z forward.
   */
  quaternion: [number, number, number, number];
}

/** Rotation matrix (row-major 3×3) from a unit quaternion (w, x, y, z). */
export function quatToMatrix(w: number, x: number, y: number, z: number): number[] {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

/**
 * COLMAP stores world-to-camera (q, t): X_cam = R·X_world + t.
 * Camera centre C = −Rᵀ·t; camera-to-world rotation = Rᵀ = conjugate(q).
 */
export function colmapPoseToCamera(qw: number, qx: number, qy: number, qz: number, tx: number, ty: number, tz: number) {
  const n = Math.hypot(qw, qx, qy, qz) || 1;
  [qw, qx, qy, qz] = [qw / n, qx / n, qy / n, qz / n];
  const R = quatToMatrix(qw, qx, qy, qz);
  const position: [number, number, number] = [
    -(R[0] * tx + R[3] * ty + R[6] * tz),
    -(R[1] * tx + R[4] * ty + R[7] * tz),
    -(R[2] * tx + R[5] * ty + R[8] * tz),
  ];
  const quaternion: [number, number, number, number] = [-qx, -qy, -qz, qw];
  return { position, quaternion };
}

/** Parse images.txt (two lines per image; the 2nd line may be empty). */
export function parseImagesTxt(text: string): CameraPose[] {
  const out: CameraPose[] = [];
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && (lines[i].startsWith('#') || !lines[i].trim())) i++;
  for (; i < lines.length; i += 2) {
    const t = lines[i].trim().split(/\s+/);
    if (t.length < 10) continue;
    const [qw, qx, qy, qz, tx, ty, tz] = t.slice(1, 8).map(Number);
    const name = t.slice(9).join(' ');
    out.push({ name, ...colmapPoseToCamera(qw, qx, qy, qz, tx, ty, tz) });
  }
  return out;
}

export interface ModelStats {
  registeredImages?: number;
  images?: number;
  points?: number;
  observations?: number;
  meanTrackLength?: number;
  meanReprojectionError?: number;
}

/** Parse `colmap model_analyzer` output. */
export function parseModelAnalyzer(text: string): ModelStats {
  const num = (re: RegExp) => {
    const m = re.exec(text);
    return m ? Number(m[1]) : undefined;
  };
  return {
    registeredImages: num(/Registered images:\s*([\d.]+)/),
    images: num(/\]\s*Images:\s*([\d.]+)/),
    points: num(/\]\s*Points:\s*([\d.]+)/),
    observations: num(/Observations:\s*([\d.]+)/),
    meanTrackLength: num(/Mean track length:\s*([\d.]+)/),
    meanReprojectionError: num(/Mean reprojection error:\s*([\d.]+)/),
  };
}

/** Map a COLMAP log line to a progress fraction within the current phase. */
export function colmapLineProgress(line: string, phase: 'extract' | 'match' | 'map', totalImages: number): number | undefined {
  if (phase === 'extract') {
    const m = /Processed file \[(\d+)\/(\d+)\]/.exec(line);
    return m ? Number(m[1]) / Number(m[2]) : undefined;
  }
  if (phase === 'match') {
    const b = /Processing block \[(\d+)\/(\d+), (\d+)\/(\d+)\]/.exec(line);
    if (b) return ((Number(b[1]) - 1) * Number(b[4]) + Number(b[3]) - 1) / (Number(b[2]) * Number(b[4]));
    const m = /\[(\d+)\/(\d+)\]/.exec(line);
    return m ? (Number(m[1]) - 1) / Number(m[2]) : undefined;
  }
  // mapping
  const reg = /Registering image #\d+ \((\d+)\)/.exec(line);
  if (reg && totalImages) return Math.min(0.95, Number(reg[1]) / totalImages);
  const phases: [RegExp, number][] = [
    [/Loading matches|Building correspondence graph/, 0.05],
    [/Running rotation averaging/, 0.15],
    [/Running track establishment/, 0.3],
    [/Running global positioning/, 0.4],
    [/Running iterative bundle adjustment/, 0.55],
    [/Running iterative retriangulation/, 0.85],
    [/Extracting colors/, 0.97],
  ];
  for (const [re, f] of phases) if (re.test(line)) return f;
  const ba = /Global bundle adjustment iteration (\d+) \/ (\d+) finished/.exec(line);
  if (ba) return 0.55 + 0.3 * (Number(ba[1]) / Number(ba[2]));
  return undefined;
}
