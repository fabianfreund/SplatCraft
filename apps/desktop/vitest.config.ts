import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/** Unit tests for pure renderer/main logic (stores, reducers). No Electron, no DOM. */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
    },
  },
  test: { include: ['src/**/*.test.ts'] },
});
