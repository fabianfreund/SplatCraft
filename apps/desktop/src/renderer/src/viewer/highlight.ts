import { SplatEdit, SplatEditRgbaBlendMode, SplatEditSdf, SplatEditSdfType } from '@sparkjsdev/spark';
import * as THREE from 'three';
import { token } from './tokens';
import type { MarkerTone, Vec3, ViewerHighlight } from './ViewerAPI';

const TONE_TOKEN: Record<MarkerTone, [string, string]> = {
  ground: ['--sc-viewer-ground', '#4ad991'],
  measure: ['--sc-viewer-measure', '#f2b84b'],
};
/** How strongly highlighted splats are tinted (added to their color). */
const TINT = 0.55;
/** Sizes relative to the content radius. */
const BRUSH = 0.018;
const SLAB = 0.006;
const EXTENT = 4;

/**
 * Tints what you are about to pick: a sphere under the cursor, and a thin slab
 * along a candidate plane. Splats via Spark SDF edits, the point cloud via a
 * small shader patch (`attachPoints`). Lives in content coordinates (add `group` to the content).
 */
export class SplatHighlight {
  readonly group = new THREE.Group();
  private brush = new SplatEditSdf({ type: SplatEditSdfType.SPHERE });
  private slab = new SplatEditSdf({ type: SplatEditSdfType.BOX });
  private brushEdit = new SplatEdit({ name: 'sc-hover', rgbaBlendMode: SplatEditRgbaBlendMode.ADD_RGBA, sdfs: [this.brush] });
  private slabEdit = new SplatEdit({ name: 'sc-plane', rgbaBlendMode: SplatEditRgbaBlendMode.ADD_RGBA, sdfs: [this.slab] });
  private size = 1;
  private last: ViewerHighlight = {};
  /** Shared by every patched point material. */
  private uniforms = {
    uHover: { value: new THREE.Vector3() },
    uHoverR: { value: 0 },
    uPlane: { value: new THREE.Vector4() },
    uSlab: { value: 0 },
    uTint: { value: new THREE.Color() },
  };

  constructor() {
    // SDF transforms come from their world matrices: keep them in the scene graph.
    this.group.add(this.brushEdit, this.slabEdit, this.brush, this.slab);
    this.set({});
  }

  /** Content radius (file units): scales the brush and slab. */
  setSize(radius: number) {
    this.size = radius;
    this.set(this.last);
  }

  set(h: ViewerHighlight) {
    this.last = h;
    const tone = token(...TONE_TOKEN[h.tone ?? 'ground']);
    const color = tone.clone().multiplyScalar(TINT);
    const u = this.uniforms;
    u.uTint.value.copy(tone);
    u.uHoverR.value = h.hover ? this.size * BRUSH : 0;
    if (h.hover) u.uHover.value.set(...h.hover);

    this.brushEdit.visible = !!h.hover;
    if (h.hover) {
      this.brush.position.set(...h.hover);
      this.brush.radius = this.size * BRUSH;
      this.brush.color.copy(color);
      this.brush.opacity = 0;
      this.brushEdit.softEdge = this.size * BRUSH * 0.5;
    }

    const plane = h.plane && planeFrame(h.plane);
    u.uSlab.value = plane ? this.size * SLAB * 2 : 0;
    if (plane) {
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(plane.rotation);
      u.uPlane.value.set(n.x, n.y, n.z, n.dot(plane.center));
    }
    this.slabEdit.visible = !!plane;
    if (plane) {
      this.slab.position.copy(plane.center);
      this.slab.quaternion.copy(plane.rotation);
      // Box half-sizes come from `scale` (z = plane normal).
      this.slab.scale.set(this.size * EXTENT, this.size * EXTENT, this.size * SLAB);
      this.slab.color.copy(color).multiplyScalar(0.8);
      this.slab.opacity = 0;
      this.slabEdit.softEdge = this.size * SLAB;
    }
    this.group.updateMatrixWorld(true);
  }

  applyTheme() {
    this.set(this.last);
  }

  /** Patches a point-cloud material so highlighted points are tinted and enlarged. */
  attachPoints(material: THREE.PointsMaterial) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          'void main() {',
          `uniform vec3 uHover; uniform float uHoverR; uniform vec4 uPlane; uniform float uSlab;
varying float vHi;
void main() {`,
        )
        .replace(
          '#include <fog_vertex>',
          `#include <fog_vertex>
  vHi = 0.0;
  if (uHoverR > 0.0) vHi = 1.0 - smoothstep(0.5 * uHoverR, uHoverR, distance(position, uHover));
  if (uSlab > 0.0) vHi = max(vHi, 0.8 * (1.0 - smoothstep(0.5 * uSlab, uSlab, abs(dot(uPlane.xyz, position) - uPlane.w))));
  gl_PointSize *= 1.0 + vHi;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform vec3 uTint;\nvarying float vHi;\nvoid main() {')
        .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, uTint, 0.75 * vHi);');
    };
    material.needsUpdate = true;
  }
}

function planeFrame(points: [Vec3, Vec3, Vec3]) {
  const [a, b, c] = points.map((p) => new THREE.Vector3(...p));
  const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
  if (n.lengthSq() < 1e-18) return null;
  n.normalize();
  return {
    center: a.clone().add(b).add(c).multiplyScalar(1 / 3),
    rotation: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n),
  };
}
