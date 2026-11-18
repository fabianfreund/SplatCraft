import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

/** Workspace packages ship raw TypeScript (`main: src/index.ts`) and must be bundled. */
const WORKSPACE_PKGS = ['@splatcraft/core', '@splatcraft/plugins', '@splatcraft/toolchain'];

const __dirname = dirname(fileURLToPath(import.meta.url));
const shared = { '@shared': resolve(__dirname, 'src/shared') };

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: {
      // Everything in package.json `dependencies` stays external (sharp, zod) except our TS packages.
      externalizeDeps: { exclude: WORKSPACE_PKGS },
      rolldownOptions: {
        // Native module: always loaded from node_modules at runtime.
        external: ['sharp', /^sharp\//, /^@img\//],
      },
    },
  },
  preload: {
    resolve: { alias: shared },
    build: {
      // Sandboxed preload scripts must be CommonJS (package.json is "type": "module" → use .cjs).
      externalizeDeps: false,
      rolldownOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        ...shared,
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    plugins: [react(), tailwindcss()],
    build: {
      rolldownOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
});
