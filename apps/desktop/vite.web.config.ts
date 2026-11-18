/**
 * Browser-only preview of the renderer (mock bridge, no Electron).
 * `pnpm dev:web` → http://localhost:5199 — used for UI work and screenshots.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
  plugins: [react(), tailwindcss()],
  server: { port: 5199, strictPort: true },
});
