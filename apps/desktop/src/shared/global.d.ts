import type { SplatCraftAPI } from './api';

declare global {
  interface Window {
    /** Exposed by the preload script (src/preload/index.ts). */
    splatcraft: SplatCraftAPI;
  }
}

export {};
