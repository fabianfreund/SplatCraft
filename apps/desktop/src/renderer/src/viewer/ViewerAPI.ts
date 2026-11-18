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

export interface ViewerAPI {
  /** Loads a splat and hot-swaps it with the current one once ready. Resolves when shown. */
  loadSplat(src: SplatSource): Promise<void>;
  loadPointCloud(url: string): Promise<{ points: number }>;
  setCameras(cameras: CameraPose[]): void;
  setLayers(layers: ViewerLayers): void;
  /** Frames the current content. */
  resetCamera(): void;
  clear(): void;
  /** PNG data URL of the current view. */
  screenshot(): string;
  dispose(): void;
}
