# SplatCraft — Research Notes (Nov 2026)

What exists, what we can build on, and what we should pick. Verify versions and licenses again before pinning anything.

## 1. How other tools work

| Tool | Model | Platforms | What to learn from it |
|---|---|---|---|
| **Jawset Postshot** | Closed, free tier, paid tiers | Windows, NVIDIA only | One window: drop media in, it extracts frames, picks the best ones, runs SfM, trains, and shows a live preview. Profiles (Splat / Splat MCMC / ADC) with step counts. The UX benchmark. |
| **LichtFeld Studio** | Open source (GPL), C++23 | Windows/Linux, NVIDIA (CUDA training, Vulkan viewer since v0.5.3) | Fastest trainer around, MCMC, crop box training, Blender export, POPSpa sparsification. Not on Mac. |
| **Brush** | Open source (Apache-2.0), Rust + wgpu + Burn | macOS (Metal), Windows, Linux, Android, web | Trains on **any GPU** with no CUDA and no Python. Prebuilt binaries for all three desktop OSes. Has a CLI. |
| **Spirula Studio** | Open source (**GPL-3.0**), C++ + Vulkan (MoltenVK on Mac) + Slang + ImGui | NVIDIA, AMD, Intel, Apple | The closest peer to our vision. One self-contained binary (no Python/COLMAP) with its own SfM (ALIKED+LightGlue, GLOMAP-style), SAM masking with text prompts, meshing, editing, 360°/fisheye support, AprilTag scale alignment and checkpoint resume. Has **training VRAM forecasting + OOM warnings + ETA**, splits large scenes into parts and merges them, has an **HTTP web viewer that streams training to a browser**, and an **MCP server**. CLI: `spirula train/sfm/mesh/sam`. Mostly a single maintainer. |
| **OpenSplat** | Open source (**AGPL-3.0**), C++/libtorch | Metal, CUDA, ROCm, CPU | Works on Mac, but the AGPL license and libtorch build are heavy to bundle. |
| **gsplat / nerfstudio** | Apache-2.0, Python + CUDA | NVIDIA (mostly) | Best features and research velocity (MCMC, 3DGUT, anti-aliasing, depth loss). Needs a Python/CUDA env. |
| **Scaniverse / Polycam / KIRI** | Closed, phone-first | iOS/Android + cloud | Capture guidance on the phone; ARKit poses mean no SfM is needed. |
| **SuperSplat (PlayCanvas)** | MIT, web | Browser | Splat editing UX: selection, crop, delete floaters, SOG export. |
| **RealityScan / Metashape** | Closed | Win/Mac | Photogrammetry-grade alignment. Many pros align there, then export COLMAP to a splat trainer. |

**Pattern every good tool shares:** ingest → frame extraction with sharpness-based selection → camera alignment (SfM) → training with a live preview → cleanup → export. The good ones hide all of that behind one button and *presets*, then expose every parameter for power users.

## 2. Pipeline building blocks

### Ingest and frame selection
- **ffmpeg / ffprobe** (LGPL build): decode any video, read metadata, extract frames. Bundle a static LGPL build.
- **Blur and quality filtering:** Laplacian variance (sharpness), exposure histogram, and perceptual-hash near-duplicate removal. Cheap and deterministic, so it runs in our own code with `sharp` or a small native helper. Optional AI quality scoring later.
- **Smart video sampling:** pick the sharpest frame per time window instead of a fixed fps (Postshot-style).
- **Masking (optional, AI):** SAM 2 (Apache-2.0) to remove people, tripods and sky.

### Camera alignment (SfM)
- **COLMAP 4.x** (BSD): **GLOMAP is now built in** (`global_mapper`, since 4.0). 4.2 keeps disconnected components as separate models. Global SfM is much faster than incremental for large sets. It needs reasonable focal-length priors; run `view_graph_calibrator` when EXIF is missing. On Mac there is no CUDA, so feature extraction and matching run on the CPU: fine for hundreds of images, slow for thousands.
- **Feed-forward alternatives (AI pack):** VGGT, MapAnything and MASt3R-SfM predict poses and depth directly. They are great for sparse or difficult captures, but **check each license**: some weights are non-commercial.
- **Poses from capture:** ARKit poses from our iPhone app can skip SfM or seed it (see §5).

### Training (the core decision)
| | Brush | OpenSplat | gsplat (Python) | LichtFeld |
|---|---|---|---|---|
| Mac (Metal) | ✅ | ✅ | ⚠️ MPS forks only | ❌ |
| Windows | ✅ | ✅ | ✅ CUDA | ✅ CUDA |
| Linux | ✅ | ✅ | ✅ CUDA | ✅ CUDA |
| AMD / Intel GPU | ✅ (Vulkan/DX12) | ROCm only | ❌ | ❌ |
| No Python/CUDA install | ✅ | needs libtorch | ❌ | needs CUDA runtime |
| License | Apache-2.0 | **AGPL-3.0** | Apache-2.0 | GPL-3.0 |
| Quality / speed | Good, improving | Good, slower | Best | Best (NVIDIA) |

Spirula Studio (GPL-3.0, Vulkan) is also cross-vendor and all-in-one. It is a strong **optional engine adapter**, downloaded separately, because bundling it would force SplatCraft to become GPL.

**Recommendation:** make the trainer a plugin. Ship **Brush as the default** because it is the only engine that works on every OS and GPU vendor, is easy to bundle, and has a permissive license. Offer **gsplat** (via the managed Python env) as the "Pro / NVIDIA" engine, and keep OpenSplat and LichtFeld as optional adapters. This **revises the earlier "OpenSplat" decision**, mainly because of the AGPL license and to support Linux and AMD.

### Viewer
- **Spark 2.x** (World Labs, MIT, three.js): mature WebGL2 renderer with streamed LoD, SPZ and SOG support. Use it now.
- **three.js r186+** has a native `GaussianSplat` (TSL, WebGL + WebGPU). **Spark Radix** is an experimental WebGPU renderer. Keep the viewer behind an interface so we can switch later.

### Export formats
PLY (universal), **SPZ** (Niantic, compact), **SOG** (PlayCanvas, very compact, web), plus a COLMAP / nerfstudio `transforms.json` dataset export so pros can train elsewhere.

## 3. Generative "fill the holes" (AI)

How the current research does it:
1. **Render novel views** of the trained splat along paths that leave the capture trajectory.
2. **Detect holes and artifacts:** low accumulated opacity, high uncertainty, floaters.
3. **Repair the 2D renders** with a diffusion model: single-step "fixer" models (NVIDIA *Difix3D+*, *GSFix3D*) or general inpainting (SD / Flux inpaint) with a mask.
4. **Distill back:** add the repaired views as pseudo ground truth with lower weight, then fine-tune the splat. Iterate.
Related work: RefFusion (reference-adapted diffusion for 3D inpainting), GA-GS (generation-assisted reconstruction, 2026).

**Reality check:** this needs ~16–24 GB of VRAM (NVIDIA) or an Apple Silicon Mac with 32 GB+ (slow on MPS), it adds minutes to hours, and model licenses vary. Ship it as an **optional, experimental "AI Repair" stage** in the AI pack, not as part of v1.

## 4. Self-installing dependencies

How others solve it: ComfyUI Desktop and Pinokio download **`uv`**, which installs a private Python and picks the right PyTorch wheel (CUDA / ROCm / MPS / CPU). That's fast, reproducible, and needs no admin rights.

Our plan has two tiers:
- **Core tier (bundled in the installer, works offline):** ffmpeg, COLMAP, Brush CLI, and SOG/SPZ tools. These are per-platform binaries that cover the whole basic pipeline.
- **AI tier (downloaded on demand from a "Add-ons" screen):** a `uv`-managed Python env with torch plus models (SAM 2, VGGT/MapAnything, gsplat, the fixer models). Each add-on has a manifest (URL, sha256, size, license, GPU requirement), and we check the hardware first.

## 5. iPhone capture app (free companion)

Goal: record datasets with **several cameras plus LiDAR at once**, with poses, and send them to the desktop.

What iOS allows (needs on-device prototyping):
- **ARKit** (`ARWorldTrackingConfiguration` + `sceneDepth`): the wide camera at ~60 fps, **6-DoF VIO pose per frame**, **LiDAR depth + confidence**, and intrinsics. This is the most valuable stream because poses mean we skip or seed SfM.
- **AVCaptureMultiCamSession:** simultaneous wide + ultra-wide (+ tele) on supported iPhones, and the LiDAR depth device (`builtInLiDARDepthCamera`). **ARKit and MultiCam cannot share the cameras**, so we would have two capture modes:
  - **Mode A, "Tracked" (default):** ARKit wide frames + poses + LiDAR depth. Also captures a high-res still every N frames (`captureHighResolutionFrame`).
  - **Mode B, "Multi-cam":** wide + ultra-wide synchronized (fixed rig, known extrinsics) + LiDAR depth, posed later by SfM using the rig constraint.
- Live capture guidance: coverage heatmap, speed and blur warnings, exposure lock. This is what makes Scaniverse captures good.
- **Output:** a folder with frames, `transforms.json` (nerfstudio-compatible), depth maps and confidence, and IMU. Transfer over the local network (Bonjour discovery + HTTP push to the desktop app), or via AirDrop / Files.
- Prior art: Record3D, Stray Scanner (open source), NeRFCapture, Spectacular Rec.
- Distribution needs an Apple Developer account (99 €/year), even for a free app.

Depth from LiDAR also improves training (depth loss in gsplat/Brush) and lets SfM be skipped entirely.

## 6. License notes
- Avoid the original Inria 3DGS code (non-commercial license).
- OpenSplat AGPL-3.0 and LichtFeld GPL-3.0 are OK as **separate, optional subprocess downloads**, but don't bundle them into an MIT app without reviewing that.
- ffmpeg: ship an LGPL build.
- AI model weights: check each one. Several are non-commercial (CC BY-NC).

## 7. Reading GPU stats on each platform (for live monitoring)
| Platform / GPU | Source | Admin needed? |
|---|---|---|
| NVIDIA (Win/Linux) | NVML (the library behind `nvidia-smi`): utilization, VRAM, temperature, power, clocks | No |
| Apple Silicon | IOKit `IOAccelerator` → `PerformanceStatistics` (device utilization, GPU memory in use), as done by `macmon`. `powermetrics` needs sudo, so avoid it. | No |
| Windows, any vendor | PDH "GPU Engine" / "GPU Adapter Memory" performance counters (what Task Manager uses) | No |
| AMD Linux | sysfs `gpu_busy_percent`, `mem_info_vram_used`, hwmon temperature/power | No |
| Intel Linux | sysfs / Level Zero Sysman | No |
| CPU, RAM, disk | `systeminformation` (npm) | No |

Plan: a small cross-platform **`sysmon` helper in Rust** that prints JSON lines at 1–2 Hz, so the Node side stays simple.

## Sources
- [Spirula Studio repo](https://github.com/harry7557558/spirula-studio) · [Spirula overview](https://pyshine.com/Spirula-Studio-3D-Gaussian-Splatting-Training-Without-the-Python-Stack/) · [v2026.9.30: partitions + VRAM forecast](https://radiancefields.com/spirula-studio-v2026.9.30-trains-large-scenes-in-parts-and-merges-them) · [v2026.9.24: editing + MCP](https://radiancefields.com/spirula-studio-v2026.9.24-adds-editing-and-an-mcp-server) · [v2026.10.30: AprilTag](https://radiancefields.com/spirula-studio-v2026.10.30-adds-apriltag-alignment) · [v2026.11.12: calibration](https://radiancefields.com/spirula-studio-v2026-11-12-adds-calibration-correction)
- [Brush v0.3](https://radiancefields.com/brush-releases-v0-3) · [Brush platform page](https://radiancefields.com/platforms/brush)
- [LichtFeld Studio](https://github.com/MrNeRF/LichtFeld-Studio) · [v0.5.3 Vulkan viewer](https://radiancefields.com/lichtfeld-studio-v0.5.3-drops-its-cuda-renderer-for-a-full-vulkan-viewer) · [v0.5.4.2](https://radiancefields.com/lichtfeld-studio-v0-5-4-2-adds-popspa-sparsification)
- [COLMAP 4.0](https://radiancefields.com/colmap-4.0-introduces-major-performance-and-infrastructure-updates) · [COLMAP 4.2](https://radiancefields.com/colmap-4.2.0-adds-multi-component-global-mapping-and-loma-learned-matching) · [COLMAP FAQ](https://colmap.github.io/faq.html)
- [Spark docs](https://sparkjs.dev/docs/overview/) · [Spark Radix](https://radiancefields.com/spark-radix-brings-webgpu-splat-rendering-to-threejs) · [three.js r186 splats](https://radiancefields.com/three.js-merges-a-native-gaussian-splat-renderer-for-webgpu-in-r186)
- [GSFix3D](https://github.com/GSFix3D/GSFix3D) · [GA-GS](https://arxiv.org/abs/2604.04331) · [RefFusion](https://arxiv.org/html/2404.10765v1)
