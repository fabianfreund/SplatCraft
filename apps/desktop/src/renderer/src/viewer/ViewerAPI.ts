/**
 * Renderer-agnostic viewer contract. `SparkViewer` implements it with
 * three.js + Spark; a native/wgpu viewer could implement the same API later.
 */
export interface CameraPose {
  name: string;
  position: [number, number, number];
  /** Camera→world rotation as [x, y, z, w] (three.js order). OpenCV camera axes (+z forward, +y down). */
  quaternion: [number, number, number, number];
}

export interface SplatSource {
  url: string;
  /** Original file path; used to infer the file type when the URL has no extension. */
  path?: string;
}

export interface ViewerLayers {
  points: boolean;
  cameras: boolean;
  splat: boolean;
}

export type Vec3 = [number, number, number];

/** Edit overlays, in file (content) coordinates. Drawn on top of everything. */
export interface ViewerMarkers {
  points: { p: Vec3; tone: MarkerTone }[];
  lines: { a: Vec3; b: Vec3; tone: MarkerTone; label?: string }[];
  triangles: { points: [Vec3, Vec3, Vec3]; tone: MarkerTone }[];
}
export type MarkerTone = 'ground' | 'measure';

/** Splats tinted on the GPU while picking (file coordinates). */
export interface ViewerHighlight {
  /** Splats around this point (the cursor). */
  hover?: Vec3 | null;
  /** Splats lying on this plane. */
  plane?: [Vec3, Vec3, Vec3] | null;
  tone?: MarkerTone;
}

export interface PickHit {
  point: Vec3;
  /** Camera position at pick time (tells which side of a surface the user looked from). */
  eye: Vec3;
}

export interface ViewerAPI {
  /** Loads a splat and hot-swaps it with the current one once ready. Resolves when shown. */
  loadSplat(src: SplatSource): Promise<void>;
  loadPointCloud(url: string): Promise<{ points: number }>;
  setCameras(cameras: CameraPose[]): void;
  setLayers(layers: ViewerLayers): void;
  /** Point-cloud point size, as a multiple of the automatic size. */
  setPointSize(scale: number): void;
  /**
   * Surface point under a screen position (splat, else point cloud), in file
   * coordinates. Null when nothing is hit.
   */
  pick(clientX: number, clientY: number): PickHit | null;
  setMarkers(markers: ViewerMarkers): void;
  setHighlight(h: ViewerHighlight): void;
  /** Column-major 4×4 transform applied to all content (file → aligned coordinates), or null. */
  setAlignment(matrix: number[] | null): void;
  /** Frames the current content. */
  resetCamera(): void;
  clear(): void;
  /** PNG data URL of the current view. */
  screenshot(): string;
  /** Pause rendering while hidden (render-on-demand otherwise). */
  setActive(active: boolean): void;
  dispose(): void;
}
