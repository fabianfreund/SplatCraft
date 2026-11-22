import * as THREE from 'three';
import type { MarkerTone } from './ViewerAPI';

/** Reads a `--sc-*` color token for three.js. */
export function token(name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
}

/** Token (and fallback) of each marker / highlight tone. */
export const TONE_TOKEN: Record<MarkerTone, [string, string]> = {
  ground: ['--sc-viewer-ground', '#4ad991'],
  measure: ['--sc-viewer-measure', '#f2b84b'],
};
