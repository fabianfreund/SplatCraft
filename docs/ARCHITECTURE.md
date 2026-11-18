# SplatCraft architecture

This is the target design. **Built in v0.1.x:** core engine with a content-hash cache, resume and cancel; plugins for media, quality, COLMAP, Brush, export and the OS/NVIDIA monitor; workflow templates; the CLI; the Electron app with live preview, Simple/Advanced modes, Monitor and Runs views, and themes. **Not built yet:** SQLite `project.db`, `utilityProcess` isolation (the engine runs in the main process), the `packages/viewer` and `packages/ui` split (both live in the renderer), the Rust `native/sysmon` helper, the AI pack, forecasts, remote monitoring and the iPhone app. Sections below that describe those are plans.

## Goals
1. **Simple by default, deep on demand:** one "Process" button with presets; every stage and parameter is reachable in Advanced mode.
2. **Cross-platform:** macOS (Apple Silicon first), Windows, Linux. Any GPU vendor.
3. **Non-destructive and resumable:** originals are never modified, every result is cached, and you can stop or quit at any time and continue later.
4. **Live feedback:** you see frames, cameras, points and the splat appear while they are computed.
5. **Extensible:** new trainers, SfM engines, AI stages, exporters and capture sources are plugins.

## Stack
| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron** + electron-vite + electron-builder | Same Chromium on every OS, so WebGL2/WebGPU behave identically. Tauri's Linux WebView (WebKitGTK) is too weak for a splat viewer. |
| UI | React + TypeScript + Tailwind + Zustand, shadcn/Radix primitives | Modern, dark, professional; fast to build. |
| Viewer | three.js + **Spark 2.x** behind a `ViewerAPI` interface | Mature renderer. Can swap to Spark Radix / three.js WebGPU later. |
| Core logic | Plain TypeScript package (`@splatcraft/core`), no Electron imports | Testable, reusable in a future CLI or headless server. |
| Job execution | Electron `utilityProcess` running the pipeline engine; tools run as child processes | The UI never blocks; a crashing tool can't take the app down. |
| Native tools | ffmpeg, COLMAP 4.x, Brush CLI (bundled); Python AI pack via `uv` (on demand) | See RESEARCH.md §4. |
| Project DB | `project.json` + SQLite (`better-sqlite3`) for per-asset metadata | Human-readable top level; fast queries over thousands of frames. |
| Schemas | zod | Params schema → validation **and** auto-generated Advanced UI. |

## Monorepo layout (target; see CLAUDE.md for the current layout)
```
apps/
  desktop/            Electron main, preload, renderer (React)
  capture-ios/        SwiftUI capture app (later)
packages/
  core/               project model, pipeline engine, cache, plugin API
  viewer/             ViewerAPI + Spark implementation
  toolchain/          binary/add-on manifests, downloader, uv bootstrap, GPU detection
  plugins/
    ingest/  frames/  quality-filter/  sfm-colmap/  train-brush/
    train-gsplat/  mask-sam2/  ai-repair/  export-ply-spz-sog/
  ui/                 shared design system components
native/
  sysmon/             Rust helper: GPU/CPU/RAM stats as JSON lines (NVML, IOKit, PDH, sysfs)
```

## Project on disk (non-destructive)
```
MyScan.splatcraft/
  project.json         name, description, tags, location, capture date, schema version, pipeline graph + params
  project.db           assets, frames, quality scores, user overrides (include/exclude)
  sources/             imported originals (copied or referenced, never modified)
  cache/<stage>/<hash>/   stage outputs, keyed by content hash
  runs/<runId>/        logs, metrics, training checkpoints, live snapshots
  exports/
```
- **Content-addressed cache:** `hash = H(stage id + stage version + tool version + params + input hashes)`. If nothing upstream changed, the result is reused instantly. If you change one parameter, only the stages downstream of it rerun. This is how "stop and pick up where you left off" works without special cases.
- **User edits are overlays:** excluding a frame or adding a mask never deletes anything; it is a record in `project.db` that feeds into the next hash.
- **Training checkpoints** are written every N steps. Resume means restarting from the last checkpoint.
- **Versions:** each run is kept, so you can compare "Run 3 (30k steps, MCMC)" against "Run 4" side by side.

## Pipeline engine
A pipeline is a small DAG of stages. Default graph:

```
Ingest → Frames → Quality filter → [Mask] → Align (SfM | ARKit poses) → Train → [Cleanup] → [AI Repair] → Export
```

```ts
interface StageDefinition<P, I, O> {
  id: string; version: string;
  title: string; category: 'ingest'|'prepare'|'align'|'train'|'refine'|'export';
  params: ZodSchema<P>;            // drives validation + the Advanced UI
  presets: Record<'fast'|'balanced'|'quality', Partial<P>>;
  requires?: ToolRequirement[];    // e.g. { tool: 'colmap', version: '>=4.0' }, { gpuMemGB: 16 }
  inputs: PortSpec<I>; outputs: PortSpec<O>;
  run(ctx: StageContext<P, I>): Promise<O>;
}

interface StageContext<P, I> {
  params: P; inputs: I; workDir: string;
  spawn(tool, args, { parseProgress }): ChildHandle;   // managed, cancellable
  progress(p: { fraction?: number; message?: string; step?: number }): void;
  emitPreview(e: PreviewEvent): void;                  // live preview (below)
  signal: AbortSignal; log: Logger;
}
```
Plugins register stages, viewers, importers (e.g. the iPhone capture format) and exporters through one `registerPlugin()` entry point. Built-ins use the same API.

## Live preview (updates while processing)
Every stage can emit `PreviewEvent`s, and the viewer shows whatever is latest:

| Stage | Live preview |
|---|---|
| Frames | Thumbnails stream into the media grid as they are extracted. |
| Quality filter | Each thumbnail gets a sharpness/exposure badge; rejected frames are greyed out, with one-click override. |
| Align | Sparse point cloud and camera frustums appear as COLMAP writes snapshot models. For ARKit captures, the poses show instantly. |
| Train | **The splat updates in the viewer during training**, with charts for loss, PSNR and Gaussian count. |
| AI Repair | Before/after toggle per repaired view. |

How training updates work:
- **v1:** the trainer adapter writes a compact snapshot (SPZ/PLY) every N steps or seconds into `runs/<id>/live/`. The engine sends `PreviewEvent{type:'splat', path, step}`. The viewer **hot-swaps** the splat and keeps the camera where you left it. The update rate is adaptive (for example, every 500 steps or 5 s, whichever comes later) so it doesn't slow training.
- **v2:** link Brush as a Rust library through a napi-rs addon and stream Gaussian buffers into the viewer via shared memory, for smooth real-time updates. The `PreviewEvent` contract stays the same.
- You can orbit, fly and compare against the source photos while it trains; pause, resume or stop at the current quality.

## Live monitoring and statistics
A persistent **status dock** (collapsible, bottom of the window) plus a full **Monitor** tab.

**Hardware (from the `sysmon` helper, 1–2 Hz):** GPU utilization, VRAM used/total, temperature, power and clocks (where the platform exposes them), plus CPU, RAM, disk free in the project folder, and disk write speed. Sparklines over the last few minutes. Warnings for thermal throttling, low disk space and VRAM close to full.

**Before training: forecasts**
- **VRAM forecast** from image count, resolution and the maximum Gaussian budget → "Fits / Tight / Will run out of memory", with a suggested fix (lower resolution, cap Gaussians, or split the scene into parts).
- **Time estimate (ETA)** from a short benchmark of the engine on this machine, refined live during the run.
- **Disk estimate** for cache and checkpoints.

**During training (per run):** live charts of loss, PSNR/SSIM on held-out views, Gaussian count, steps/s, learning rate and densification events, plus an ETA. Hover a chart point to jump the viewer to the snapshot from that step.

**Dataset statistics:**
- Frames: imported / extracted / kept / rejected, with the reason (blurry, over- or under-exposed, duplicate), and a sharpness histogram with a draggable threshold.
- Alignment: % of cameras registered, mean reprojection error, point count, track length, a coverage heatmap, and disconnected components.

**Run comparison:** a table and overlaid charts across runs (params diff, final PSNR, size, time), plus a side-by-side viewer.

**Remote monitoring:** an optional local HTTP server that serves the status, charts and a light web viewer, so you can watch a long training from a phone or another PC on the same network. Spirula does this for its viewer. It is off by default and requires a token.

All metrics are written to `runs/<id>/metrics.jsonl`, so the stats survive restarts and can be exported to CSV.

## Simple vs. power user
- **Simple:** drop files → choose Fast, Balanced or Quality → Process. Smart defaults come from the media (video vs. photos, count, resolution, EXIF) and the hardware (GPU, VRAM).
- **Advanced:** a node view of the pipeline. Each stage shows its parameters (generated from zod), logs, the exact command line, and an "extra args" field. You can save custom presets, import an existing COLMAP or `transforms.json` dataset, and skip or replace any stage.

## Toolchain manager
- `toolchain/manifest.json` lists each tool or add-on per platform and arch: URL, sha256, size, license, and minimum GPU.
- On first launch the app detects the GPU (Metal / CUDA / Vulkan / DX12) and VRAM, then verifies the bundled tools.
- The Add-ons screen installs the AI pack: it downloads `uv` → creates a private Python env → installs torch for the detected backend → downloads model weights. Every add-on can be removed and repaired.

## Roadmap
| Phase | Scope |
|---|---|
| **v0.1** | Project model and cache, ingest (photos + video), frame extraction, quality filter, COLMAP global SfM, Brush training with live preview, status dock with GPU/VRAM monitoring and training charts, PLY/SPZ export. macOS + Windows. |
| **v0.2** | Linux, presets and Advanced node view, VRAM/ETA forecasts, run comparison, remote web monitor, SOG export, crop/clean tools, dataset import and export, Spirula engine adapter. |
| **v0.2.x** | Large-scene partitioning (train in parts, then merge), marker-based scale alignment (AprilTag), 360°/fisheye input, an MCP server so AI agents can drive projects. |
| **v0.3** | AI pack via uv: SAM 2 masking, gsplat "Pro" engine, feed-forward alignment (VGGT/MapAnything, license permitting). |
| **v0.4** | iPhone capture app (ARKit + LiDAR, multi-cam mode), Wi-Fi transfer into a project. |
| **v0.5+** | AI Repair (diffusion hole filling), splat editor, scene/prefab system (`.csp`). |
