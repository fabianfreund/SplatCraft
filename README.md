# SplatCraft

A cross-platform Gaussian Splatting studio. Drop in photos or videos and process them; the app extracts and filters frames, aligns cameras, trains the splat with a live preview, and exports it.

**Status:** prototype (v0.1). Tested on macOS (Apple Silicon); Windows and Linux are wired up but untested.

## Quick start
```bash
pnpm install
pnpm dev                     # desktop app (Electron)
```
On macOS the app finds `ffmpeg` and `colmap` from Homebrew and downloads Brush itself (Tools & Add-ons → Install).

### Headless CLI
```bash
./scripts/fetch-sample.sh             # test scene (NVlabs/instant-ngp fox)
pnpm cli new ~/Scans "Fox"
pnpm cli add ~/Scans/Fox.splatcraft samples/fox/images
pnpm cli run ~/Scans/Fox.splatcraft --preset fast
pnpm cli run ~/Scans/Fox.splatcraft --set train.totalSteps=5000   # only train + export re-run
pnpm cli tools --install brush
```

## Layout
```
packages/core        project model, plugin registry, pipeline engine (content-hash cache, resume, cancel)
packages/toolchain   finds/installs external tools (env → managed → bundled → PATH)
packages/plugins     built-in plugins: media, quality, colmap, brush, export, monitor
packages/cli         headless runner
apps/desktop         Electron app (main, preload, React renderer)
scripts/             fetch-sample.sh downloads a 50-image test scene into samples/fox
docs/                research + architecture
```

## Writing a plugin
```ts
import { definePlugin, defineStage } from '@splatcraft/core';
import { z } from 'zod';

export default definePlugin({
  id: 'acme.denoise', name: 'Denoise', version: '0.1.0',
  register(api) {
    api.registerStage(defineStage({
      id: 'acme.refine.denoise', version: '1', title: 'Denoise', description: '…',
      category: 'refine', inputs: ['frames'], outputs: ['frames'],
      paramsSchema: z.object({ strength: z.number().min(0).max(1).default(0.5).describe('…') }),
      async run(ctx) { /* write to ctx.workDir, report ctx.progress / ctx.preview */ return { outputs: { frames: { path: ctx.workDir } } }; },
    }));
  },
});
```
Stages are wired together by artifact kind (`sources → frames → dataset → splat → export`), so a stage can be swapped for any other with the same inputs and outputs (for example a different trainer). The params schema drives both validation and the Advanced UI.

## License
MIT. Third-party tools keep their own licenses (Brush Apache-2.0, COLMAP BSD, ffmpeg LGPL/GPL depending on build).
