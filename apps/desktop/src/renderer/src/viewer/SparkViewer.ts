import { SparkRenderer, SplatFileType, SplatMesh } from '@sparkjsdev/spark';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import type { CameraPose, SplatSource, ViewerAPI, ViewerLayers } from './ViewerAPI';

function token(name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
}

function fileTypeOf(p?: string): SplatFileType | undefined {
  const ext = p?.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ply':
      return SplatFileType.PLY;
    case 'spz':
      return SplatFileType.SPZ;
    case 'splat':
      return SplatFileType.SPLAT;
    case 'ksplat':
      return SplatFileType.KSPLAT;
    case 'sog':
      return SplatFileType.PCSOGSZIP;
    default:
      return undefined;
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

/** Robust bounds: 5th–95th percentile per axis of (sampled) points. */
function robustSphere(xs: number[], ys: number[], zs: number[]): THREE.Sphere | null {
  if (xs.length < 2) return null;
  const q = (a: number[], f: number) => a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * f)))];
  const sx = [...xs].sort((a, b) => a - b);
  const sy = [...ys].sort((a, b) => a - b);
  const sz = [...zs].sort((a, b) => a - b);
  const box = new THREE.Box3(new THREE.Vector3(q(sx, 0.05), q(sy, 0.05), q(sz, 0.05)), new THREE.Vector3(q(sx, 0.95), q(sy, 0.95), q(sz, 0.95)));
  return box.getBoundingSphere(new THREE.Sphere());
}

/**
 * three.js + Spark implementation of ViewerAPI.
 *
 * Hot-swap: a new SplatMesh is created off-scene, awaited (`initialized`),
 * added next to the old one, given a few frames to sort, then the old mesh is
 * removed and disposed. The camera is never touched after the first framing.
 * Out-of-order loads are discarded via a monotonically increasing token.
 */
export class SparkViewer implements ViewerAPI {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private spark: SparkRenderer;
  /** COLMAP/3DGS content is y-down; flip once for everything we load. */
  private content = new THREE.Group();
  private splat?: SplatMesh;
  private points?: THREE.Points;
  private cameraGizmos?: THREE.LineSegments;
  private splatToken = 0;
  private pointsToken = 0;
  private framed = false;
  private bounds?: THREE.Sphere;
  private layers: ViewerLayers = { points: true, cameras: true, splat: true };
  private ro: ResizeObserver;
  private disposed = false;
  private grid?: THREE.GridHelper;
  /** Render-on-demand budget: frames left to draw (Spark sorts asynchronously, so a change needs a short tail). */
  private frames = 0;
  private active = true;
  /**
   * Splat layer fades via opacity instead of `visible`. Toggling `visible` makes Spark regenerate
   * every splat when it returns (a multi-second stall on big scenes, e.g. Align → Train). Keeping it
   * warm costs GPU only while frames render, which is on demand (orbit / changes), never when idle.
   */
  private splatOpacity = 1;
  private splatTarget = 1;
  private onTheme = () => this.applyTheme();

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(token('--sc-viewport', '#08090b'));
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.outline = 'none';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 2000);
    this.camera.position.set(3.2, 2.2, 4.2);

    this.spark = new SparkRenderer({ renderer: this.renderer });
    this.scene.add(this.spark);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;

    this.applyTheme();
    window.addEventListener('sc-theme-change', this.onTheme);

    this.content.rotation.x = Math.PI;
    this.scene.add(this.content);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.controls.addEventListener('change', () => this.invalidate());
    this.splatTarget = this.splatOpacity = this.layers.splat ? 1 : 0;
    this.renderer.setAnimationLoop(() => {
      if (!this.active) return;
      if (this.controls.update()) this.invalidate();
      if (this.splatOpacity !== this.splatTarget) {
        const step = 1 / 13; // ~220ms at 60fps
        this.splatOpacity = this.splatTarget > this.splatOpacity ? Math.min(this.splatTarget, this.splatOpacity + step) : Math.max(this.splatTarget, this.splatOpacity - step);
        if (this.splat) this.splat.opacity = this.splatOpacity;
        this.invalidate(30);
      }
      if (this.frames <= 0) return;
      this.frames--;
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** Request frames (orbit, content or layer change). */
  invalidate(frames = 90) {
    this.frames = Math.max(this.frames, frames);
  }

  /** Pause rendering entirely while the viewer is hidden behind another view. */
  setActive(active: boolean) {
    this.active = active;
    if (active) this.invalidate();
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  async loadSplat(src: SplatSource): Promise<void> {
    const t = ++this.splatToken;
    const mesh = new SplatMesh({ url: src.url, fileType: fileTypeOf(src.path ?? src.url), fileName: src.path?.split(/[\\/]/).pop() });
    try {
      await mesh.initialized;
    } catch (e) {
      mesh.dispose();
      throw e;
    }
    if (t !== this.splatToken || this.disposed) {
      mesh.dispose();
      return;
    }
    mesh.opacity = this.splatOpacity;
    this.invalidate(120);
    this.content.add(mesh);
    const old = this.splat;
    this.splat = mesh;
    if (!this.framed) this.frameFromSplat(mesh);
    if (old) {
      // Let the new mesh render + sort before removing the old one → no flicker.
      await nextFrame();
      await nextFrame();
      await wait(120);
      this.content.remove(old);
      old.dispose();
      this.invalidate();
    }
  }

  async loadPointCloud(url: string): Promise<{ points: number }> {
    const t = ++this.pointsToken;
    const geom = await new PLYLoader().loadAsync(url);
    if (t !== this.pointsToken || this.disposed) {
      geom.dispose();
      return { points: 0 };
    }
    geom.computeBoundingSphere();
    const r = geom.boundingSphere?.radius ?? 1;
    const hasColor = !!geom.getAttribute('color');
    const mat = new THREE.PointsMaterial({
      size: Math.max(0.002, r / 260),
      sizeAttenuation: true,
      vertexColors: hasColor,
      color: hasColor ? 0xffffff : token('--sc-viewer-points', '#c9ced6'),
      transparent: true,
      opacity: 0.95,
    });
    const pts = new THREE.Points(geom, mat);
    pts.visible = this.layers.points;
    this.removePoints();
    this.points = pts;
    this.invalidate(120);
    this.content.add(pts);
    if (!this.framed) {
      const pos = geom.getAttribute('position');
      const xs: number[] = [];
      const ys: number[] = [];
      const zs: number[] = [];
      const stride = Math.max(1, Math.floor(pos.count / 20000));
      const v = new THREE.Vector3();
      this.content.updateMatrixWorld();
      for (let i = 0; i < pos.count; i += stride) {
        v.fromBufferAttribute(pos, i).applyMatrix4(this.content.matrixWorld);
        xs.push(v.x);
        ys.push(v.y);
        zs.push(v.z);
      }
      this.applyBounds(robustSphere(xs, ys, zs));
    }
    return { points: geom.getAttribute('position').count };
  }

  setCameras(cameras: CameraPose[]): void {
    this.invalidate();
    this.removeCameras();
    if (!cameras.length) return;
    const scale = (this.bounds?.radius ?? 1) * 0.035;
    const w = scale * 0.8;
    const h = scale * 0.55;
    const d = scale;
    const corners = [new THREE.Vector3(-w, -h, d), new THREE.Vector3(w, -h, d), new THREE.Vector3(w, h, d), new THREE.Vector3(-w, h, d)];
    const apex = new THREE.Vector3();
    const verts: number[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const push = (a: THREE.Vector3, b: THREE.Vector3) => {
      const A = a.clone().applyMatrix4(m);
      const B = b.clone().applyMatrix4(m);
      verts.push(A.x, A.y, A.z, B.x, B.y, B.z);
    };
    for (const c of cameras) {
      q.set(c.quaternion[0], c.quaternion[1], c.quaternion[2], c.quaternion[3]);
      p.set(c.position[0], c.position[1], c.position[2]);
      m.compose(p, q, one);
      for (let i = 0; i < 4; i++) {
        push(apex, corners[i]);
        push(corners[i], corners[(i + 1) % 4]);
      }
      // "up" tick so orientation is readable
      push(new THREE.Vector3(-w * 0.35, -h, d), new THREE.Vector3(0, -h * 1.45, d));
      push(new THREE.Vector3(0, -h * 1.45, d), new THREE.Vector3(w * 0.35, -h, d));
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({ color: token('--sc-viewer-camera', '#6cc3b5'), transparent: true, opacity: 0.75 });
    this.cameraGizmos = new THREE.LineSegments(geom, mat);
    this.cameraGizmos.visible = this.layers.cameras;
    this.invalidate(120);
    this.content.add(this.cameraGizmos);
  }

  setLayers(layers: ViewerLayers): void {
    this.layers = layers;
    this.splatTarget = layers.splat ? 1 : 0;
    if (this.points) this.points.visible = layers.points;
    if (this.cameraGizmos) this.cameraGizmos.visible = layers.cameras;
    this.invalidate();
  }

  resetCamera(): void {
    this.invalidate();
    if (this.splat) this.frameFromSplat(this.splat);
    else if (this.bounds) this.applyBounds(this.bounds);
    else {
      this.camera.position.set(3.2, 2.2, 4.2);
      this.controls.target.set(0, 0, 0);
    }
  }

  clear(): void {
    this.invalidate();
    this.splatToken++;
    this.pointsToken++;
    if (this.splat) {
      this.content.remove(this.splat);
      this.splat.dispose();
      this.splat = undefined;
    }
    this.removePoints();
    this.removeCameras();
    this.framed = false;
    this.bounds = undefined;
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('sc-theme-change', this.onTheme);
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    this.clear();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /* ---------------------------------------------------------------- */

  /** Re-reads the viewer tokens (theme or accent changed). */
  private applyTheme() {
    this.invalidate();
    this.renderer.setClearColor(token('--sc-viewport', '#08090b'));
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.dispose();
    }
    const grid = new THREE.GridHelper(24, 48, token('--sc-viewer-grid-center', '#262a31'), token('--sc-viewer-grid', '#1b1e24'));
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.9;
    (grid.material as THREE.Material).depthWrite = false;
    grid.renderOrder = -1; // draw first so splats blend over it
    this.scene.add(grid);
    this.grid = grid;
    if (this.cameraGizmos) (this.cameraGizmos.material as THREE.LineBasicMaterial).color = token('--sc-viewer-camera', '#6cc3b5');
    const pm = this.points?.material as THREE.PointsMaterial | undefined;
    if (pm && !pm.vertexColors) pm.color = token('--sc-viewer-points', '#c9ced6');
  }

  private frameFromSplat(mesh: SplatMesh) {
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    const n = mesh.packedSplats?.numSplats ?? 0;
    const stride = Math.max(1, Math.floor(n / 20000));
    this.content.updateMatrixWorld();
    const mw = this.content.matrixWorld;
    const v = new THREE.Vector3();
    try {
      mesh.forEachSplat((i, center) => {
        if (i % stride) return;
        v.copy(center).applyMatrix4(mw);
        xs.push(v.x);
        ys.push(v.y);
        zs.push(v.z);
      });
    } catch {
      /* not all sources support iteration */
    }
    this.applyBounds(robustSphere(xs, ys, zs));
  }

  private applyBounds(s: THREE.Sphere | null) {
    if (!s || !Number.isFinite(s.radius) || s.radius <= 0) return;
    this.bounds = s;
    this.framed = true;
    const dist = s.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 0.9;
    const dir = new THREE.Vector3(0.55, 0.35, 0.76).normalize();
    this.controls.target.copy(s.center);
    this.camera.position.copy(s.center).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.001, dist / 1000);
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private removePoints() {
    if (!this.points) return;
    this.content.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.points = undefined;
  }

  private removeCameras() {
    if (!this.cameraGizmos) return;
    this.content.remove(this.cameraGizmos);
    this.cameraGizmos.geometry.dispose();
    (this.cameraGizmos.material as THREE.Material).dispose();
    this.cameraGizmos = undefined;
  }
}
