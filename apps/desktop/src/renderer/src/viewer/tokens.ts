import * as THREE from 'three';

/** Reads a `--sc-*` color token for three.js. */
export function token(name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
}
