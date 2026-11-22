import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { TONE_TOKEN, token } from './tokens';
import type { MarkerTone, Vec3, ViewerMarkers } from './ViewerAPI';

/** Overlays draw after (and over) the scene. */
const ON_TOP = 1000;
const POINT_PX = 13;

let disc: THREE.Texture | undefined;
/** Round point sprite with a dark rim, so markers read on any splat. */
function discTexture(): THREE.Texture {
  if (disc) return disc;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(32, 32, 28, 0, Math.PI * 2);
  g.fillStyle = '#fff';
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.stroke();
  disc = new THREE.CanvasTexture(c);
  disc.colorSpace = THREE.SRGBColorSpace;
  return disc;
}

const overlay = <M extends THREE.Material>(m: M): M => Object.assign(m, { depthTest: false, depthWrite: false, transparent: true });

/** Edit markers (picked points, measure lines, ground triangle) in content coordinates. */
export class MarkerLayer {
  readonly group = new THREE.Group();
  private last: ViewerMarkers = { points: [], lines: [], triangles: [] };

  set(m: ViewerMarkers) {
    this.last = m;
    this.clear();
    for (const tone of Object.keys(TONE_TOKEN) as MarkerTone[]) {
      const color = token(...TONE_TOKEN[tone]);
      const tris = m.triangles.filter((t) => t.tone === tone);
      if (tris.length) {
        const fill = new THREE.BufferGeometry().setFromPoints(tris.flatMap((t) => t.points.map(v3)));
        this.add(new THREE.Mesh(fill, overlay(new THREE.MeshBasicMaterial({ color, opacity: 0.2, side: THREE.DoubleSide }))));
        const edges = tris.flatMap((t) => [0, 1, 1, 2, 2, 0].map((i) => v3(t.points[i])));
        this.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(edges), overlay(new THREE.LineBasicMaterial({ color, opacity: 0.9 }))));
      }
      const lines = m.lines.filter((l) => l.tone === tone);
      if (lines.length) {
        const segs = lines.flatMap((l) => [v3(l.a), v3(l.b)]);
        this.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), overlay(new THREE.LineBasicMaterial({ color }))));
      }
      const pts = m.points.filter((p) => p.tone === tone);
      if (pts.length) {
        const mat = overlay(new THREE.PointsMaterial({ color, size: POINT_PX, sizeAttenuation: false, map: discTexture(), alphaTest: 0.4 }));
        this.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts.map((p) => v3(p.p))), mat));
      }
    }
    for (const l of m.lines) {
      if (!l.label) continue;
      const el = document.createElement('div');
      el.className = 'glass tnum rounded-md border px-1.5 py-0.5 text-xs font-medium text-fg';
      el.textContent = l.label;
      const label = new CSS2DObject(el);
      label.position.copy(v3(l.a).add(v3(l.b)).multiplyScalar(0.5));
      this.group.add(label);
    }
  }

  /** Tokens changed (theme / accent). */
  applyTheme() {
    this.set(this.last);
  }

  dispose() {
    this.clear();
  }

  private add(o: THREE.Mesh | THREE.LineSegments | THREE.Points) {
    o.renderOrder = ON_TOP;
    o.frustumCulled = false;
    this.group.add(o);
  }

  private clear() {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Points) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    }
  }
}

const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
