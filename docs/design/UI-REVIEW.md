# SplatCraft UI review and redesign (2026-11-18)

Contents: a screenshot audit of v0.1, research into PostShot and peer tools (plus what users ask for and the Figma UI3 lessons), what this pass changed, and a ranked roadmap.

Screenshots: `screenshots/before/` (v0.1) and `screenshots/after/` (this pass). They were taken in the browser preview (`pnpm --filter @splatcraft/desktop dev:web`) with mock data.

---

## 1. Audit of v0.1

**Good, keep it**
- A tokenized design system. Tailwind's palette is locked, so only tokens can be used.
- The calm dark look, and the welcome window modeled on Xcode's.
- The numbered workflow stepper, with stats on each step (`62/72`, `62 cams`, `1.8M`, `41 MB`).
- The live 3D viewer with camera frustums and splat hot-swap, and the layer toggles.
- The Monitor charts (loss, PSNR, Gaussians, speed, GPU, VRAM), plus hardware meters always visible in the status bar.
- The reserved-slot discipline that avoids layout shift.

**Problems found**
| # | Where | Issue |
|---|---|---|
| 1 | Top bar | Four icon-only buttons (Messages, Monitor, Runs, Tools), plus Simple/Advanced shown as two **unlabeled icons**. You can't tell what does what. |
| 2 | Top bar | Views were split across two controls: Gallery/Viewer as tabs, Monitor/Runs as toggle icons. |
| 3 | Rail | A "?" next to every step title: five identical icons of visual noise. |
| 4 | Gallery | An empty 44px band between the header and the grid, reserved for the review bar. |
| 5 | Inspector | An **empty grey box** under the step header before a step has run. |
| 6 | Inspector | Raw parameter names: "Sh degree", "Lr scale", "Psnr". |
| 7 | Inspector | No live information while training (only "62%" in a chip). |
| 8 | Status bar | Seven hardware meters even in Simple mode. |
| 9 | Color | The electric teal accent (`#3ce4ce`) is the loudest thing on screen, and full accent fills on selected list rows and menu hovers amplify it. |
| 10 | Rail | The preset was a three-way toggle with no time estimate (the estimate only appeared in a tooltip). |
| 11 | Customization | Only one theme. No density, text size, accent or panel sizing. |
| 12 | a11y | The running step's accessible name included `0.6066666666666667`. |

---

## 2. Research synthesis

Three research passes: what users want, PostShot in depth, and peer tools plus multi-workflow. **Caveat:** reddit.com blocked automated reading. Evidence comes mainly from vendor docs, release notes, GitHub issues, the Figma forum and mirror threads, so treat the user-sentiment rankings as judgment, not counts.

### What users struggle with (approximate ranking)
1. **Install and setup friction** in free tools (Nerfstudio on Windows, COLMAP dependencies, "can't get Brush running").
2. **Alignment fails with no explanation** ("registered 20 of 200 images").
3. **Paywalls and platform lock-in.** PostShot is Windows/NVIDIA only and PLY export is paid. Polycam locks exports behind its plans.
4. **Confusing training profiles and parameters.**
5. **Tedious floater cleanup.**
6. **Too many export formats** (PLY, compressed PLY, SPZ, SOG, .splat).
7. **Running out of VRAM** during densification.
8. **Wrong ETA and silent stalls.**

### What users want
One app from drop to result with good defaults, running locally, free, cross-platform. Tools that just work. Alignment diagnostics. A live preview with pause, adjust and continue. A VRAM-aware splat cap. Automatic floater removal plus brush and box tools. Plain-language export presets. Pose import and export. A project file that saves state.

### PostShot: what to copy
- **One import popup with safe defaults.** "Keep the defaults, click Import." It shows Profile, Max image count (100–300), Max splats, and *Start training* checked by default. Everything else sits in collapsed **Advanced** groups.
- **Profiles** (Splat3 / MCMC / ADC) instead of hyperparameters. Max Splat Count is the main setting, and since v1.0 it is capped automatically to fit GPU memory.
- **Pause → change max splats or steps → continue**, all on one button. Elapsed and remaining time stay correct across pauses.
- An **Info** block with kSplats, SSIM, step and registered images. Image Set counts: *Imported / Selected / Tracked*.
- The **Image Set camera mode**: step through each training photo from its pose and compare the render against it.
- **Viewport:** Orbit/Ego (WASDQC), double-click to set the target, overlay toggles (grid, axes, frustums, points, field), crop box and a **training region of interest**, brush/rect/lasso selection with add/subtract/intersect.
- **One export dialog:** PLY (lossless), SPZ (quality 1–6), self-contained HTML, with an SH-degree cap.
- **Weak points to avoid:** very slow defaults (a 12 h ETA for a 10 s clip), Windows/NVIDIA only, paid export.

Sources: [Interface](https://www.jawset.com/docs/d/Postshot+User+Guide/Interface), [Training Configuration](https://www.jawset.com/docs/d/Postshot+User+Guide/Interface/Training+Configuration), [Viewport Tools](https://www.jawset.com/docs/d/Postshot+User+Guide/Interface/Viewport+Tools), [Export](https://www.jawset.com/docs/d/Postshot+User+Guide/Interface/Radiance+Field+Export), [v1.0 notes](https://www.jawset.com/docs/d/Postshot+User+Guide/Release+Notes/v1.0), [v1.1 (radiancefields)](https://radiancefields.com/postshot-v1.1-released-vr-preview-photometric-compensation-and-a-rebuilt-selection-toolkit).

### Figma UI3 lessons
- Figma **rolled back** floating panels because they "cramped the canvas". Keep panels docked and offer one key to hide all UI.
- **Resizable panels** were the most praised change.
- Property panels must keep a stable order, keep actions separate from parameters, and **show values that differ from the default**.
- "Speed over novelty": hidden controls hurt heavy users most.

Source: [Our approach to designing UI3](https://www.figma.com/blog/our-approach-to-designing-ui3/).

### Simple and Advanced modes
- **Same layout in both modes.** Advanced only *adds* (views, an inspector, per-step menus). Switching never resets values. Avoid a "Lightroom vs Classic" split into two different apps.
- Use **presets and profiles** for beginners (PostShot) and task stages for structure (Resolve pages). Hidden settings stay hidden, so mark customized steps visibly.

### Peer tools and the multi-workflow future
- **SuperSplat:** a left tool rail of selection tools with a pre-selection preview, and a bottom bar with live splat counts.
- **LichtFeld Studio:** a `.licht` project file and training inside a live crop box.
- **Brush:** orbit while training and compare against the input photos.
- **RealityScan 2.0:** a heatmap showing capture coverage.
- **KIRI 4.3:** praised for merging several capture modes into one entry point.
- **Apple ML SHARP:** one image → 3DGS `.ply` in under 1 s.
  - Focal length comes from EXIF.
  - Outputs use OpenCV axes, so the app must re-orient them.
  - Runs on CUDA, MPS or CPU.
  - The weights are reportedly **non-commercial**; check before bundling.
- **Depth Anything 3:** any number of views → depth, confidence, poses (COLMAP format), and even 3DGS. Large and Giant are CC BY-NC; Small and Base are Apache-2.0.
- **VGGT, MASt3R, DUSt3R:** pose-free alignment; InstantSplat saves the result as a COLMAP workspace that Brush can read.
- **Recommended pattern:**
  - Pick a workflow when creating a project.
  - Store each workflow internally as a **recipe** (the existing `PipelineTemplate`): stages, each with swappable engines, shown in the linear stepper.
  - One-shot models (SHARP, single-image depth) get a **fast path**: drop an image, get a result, then "Promote".
  - Same viewport for all workflows, with view modes RGB / depth / confidence / points.
  - Models install on demand with a license badge.

Sources: [ml-sharp](https://github.com/apple/ml-sharp), [Depth-Anything-3](https://github.com/ByteDance-Seed/Depth-Anything-3), [SuperSplat interface](https://developer.playcanvas.com/user-manual/supersplat/editor/interface/), [LichtFeld Studio](https://github.com/MrNeRF/LichtFeld-Studio), [Brush](https://github.com/ArthurBrussee/brush), [ComfyUI templates](https://docs.comfy.org/interface/features/template).

---

## 3. What this pass changed

| Area | Change |
|---|---|
| **Accent** | A calmer default teal (`#6cc3b5`, was `#3ce4ce`) and a muted palette of six presets (Teal, Blue, Violet, Rose, Amber, Sage). Selected list rows and menu hovers now use a soft tint instead of a full accent fill, and the glow is softer. |
| **Top bar** | Left: project and a **labeled Simple/Advanced** toggle. Center: **one view switcher**. Simple shows Gallery and Viewer; Advanced appends Monitor and Runs. Right: Focus mode, Messages, Settings, Run step / Run all. |
| **Simple / Advanced** | Same layout in both. Advanced adds the inspector, Monitor/Runs views, per-step "…" menus and the full set of hardware meters. Leaving Advanced keeps all values. |
| **Step focus** | Each step declares what it shows (`focusFor` in `lib/steps.ts`): Media → gallery of input media; Review → frames with kept/rejected; Align → viewer with points + cameras; Train/Export → viewer with the splat only. Applies when a step **starts running** (the inspector follows too) and when you **click back** to a step. A view picked by hand during a step is respected until the next step starts, and Monitor/Runs are never switched away automatically. New workflow stages only need an entry in the map. |
| **Canvas toolbar** | A Figma-style floating pill at the bottom of the gallery/viewer (`CanvasToolbar.tsx`), laid out as **view tools · step actions · primary**. Viewer tools: Points/Cameras/Splat, Reset view, Screenshot (moved from the top-right overlay). Gallery tools: Add media, Show folder. Step actions come from a `STEP_ACTIONS` map by category. Media: re-extract → *Extract/Continue*. Review: reset manual picks, re-score → *Continue*. Align: re-align → *Align/Continue*. Train: retrain, **Train longer** (+50% steps), **More detail** (+50% splats, +25% steps) → *Train/Export*. Export: show in folder, copy path → *Export/Re-export*. The primary becomes **Stop** while running. Trainer parameter names are resolved through aliases (`totalSteps`/`steps`, `maxSplats`…). |
| **Motion pass** | Tokens: `--sc-ease-spring` / `--sc-ease-snap` (CSS `linear()` springs), `--sc-duration-spring`, `--sc-press-scale`, all zeroed under Reduce motion. Animations use transform/opacity only and run ≤ 260ms of visible travel. Effects: `.press` squish on every button, chip and tile. Segmented highlight does a **liquid stretch** (leading edge first, trailing edge 55ms later). Toolbar toggles' highlights **fuse into one capsule** when neighbours are on. Toolbar width morphs when tools change, and step actions slide in. Switch knob springs and stretches while pressed. Stepper ✓ pops and the connector **draws downward** on completion. Gallery tiles zoom 3% on hover; menus, popovers and dialogs spring from their origin; views cross-fade. |
| **Glass** | `.glass` utility (`--sc-glass-*` tokens): frosted translucent surface, one hairline border, top highlight, soft drop shadow. Used by the canvas toolbar, dropdowns, menus, popovers, tooltips and loaders. *Settings → Appearance → Reduce transparency* switches to solid surfaces. |
| **Dropdowns** | `Select` is now custom: a glass listbox that springs open with the selected row over the trigger (macOS style). Keyboard: ↑↓ / Home / End / Enter / Esc / type-ahead. Uses the ARIA combobox pattern (focus stays on the trigger). |
| **Scroll areas** | Every `.scroll-stable` gets edge fades only where content is hidden (animated `@property` masks), and the scrollbar shows only while scrolling or hovering (`lib/scrollPolish.ts`, no wrappers). |
| **Loading** | `LoadingOverlay`: blurs the region (or the app), glass card with a compositor-driven ring and optional progress. A 150ms delay prevents flashes; it stays at least 350ms once shown. Used when opening a project, while the workspace prepares, and for the first splat load. |
| **Viewer performance** | **Render on demand:** frames are drawn only after orbit, content, layer or resize changes, plus a short tail for Spark's async sort. The viewer pauses entirely while hidden. The splat layer fades via `SplatMesh.opacity` instead of toggling `visible`, so turning it back on (e.g. switching to Train) no longer forces Spark to regenerate millions of splats. |
| **Toggles** | `SegmentedControl` measures its labels: equal widths, 12–14px inner padding, a 3px inset around the pill, a softer active pill, and an accent-tinted icon. |
| **Focus mode** | `\` (or the top-bar button) hides the rail, inspector and status bar, as with Figma's hide-UI key. |
| **Settings** | A new Settings dialog (⌘,) with **General** (mode, status-bar meters, shortcuts), **Appearance** (theme, accent, density, text size, reduced motion, copy/paste custom theme, reset) and **Tools & Add-ons** (formerly its own dialog). |
| **Themes** | A full **light theme** and system theme. A token layering of inputs → theme → derived (`color-mix`) → density. Custom accents get computed ink and light-theme contrast. The 3D viewer follows theme changes live. |
| **Density / text** | Compact, Default and Comfortable control and panel sizes; S/M/L text scale (type and line heights scale together). |
| **Panels** | Rail and inspector are **resizable** (drag the edge, double-click to reset) and remembered across sessions. |
| **Rail** | Titled "Workflow". "?" icons appear only on hover or focus. An accent dot marks **customized** steps (overrides vs. the preset). Presets are a **profile list with time estimates** (Fast ~5 min / Balanced ~20 min / Quality 1 h+). |
| **Gallery** | The review strip (kept · rejected · Continue) is merged into the header, so the empty band is gone. |
| **Inspector** | The results block shows dashes before a run and **Progress and Elapsed** while running. Labels are humanized (SH degree, LR scale, PSNR, FPS…). |
| **Status bar** | Meters follow the setting: Auto shows GPU + VRAM (+ Disk) in Simple and all meters in Advanced; Essential and All can also be chosen. |
| **Component library** | New primitives: `SwatchPicker`, `ResizeHandle`, `NavList`, `RadioList`. `StepperItem` gains `modified` and uses the density row height. Fixed `ProgressBar` a11y. Alphabetical barrel. `ui/README.md`. A **UI kit** page at `?kit`. |
| **Dev** | `pnpm --filter @splatcraft/desktop dev:web` runs the renderer in a browser with the mock bridge, used for UI work and screenshots. |
| **Wording** | "Pipeline" → "Workflow" in the rail and the New Project sheet. |

---

## 4. Roadmap (ranked)

### Next (high impact, mostly UI)
1. **Import sheet on drop, PostShot-style.** Profile, max images, max splats, "Start training" checked by default, with an Advanced disclosure. One click from drop to training.
2. **Pause / adjust / continue training.** One stateful button, with max splats and steps editable while paused (needs trainer support).
3. **Alignment diagnostics.** Registered/total cameras on the Align step, unregistered frames highlighted in the gallery, and a likely cause (blur, low overlap, moving object) in a Callout.
4. **Live training block in the inspector.** Step, splats, loss/PSNR sparkline, elapsed and remaining, in place of static parameters while running.
5. **VRAM forecast** before training. Show estimated peak VRAM next to Max splats and warn or cap automatically when over budget.
6. **Plain-language export presets:** *Web (SOG/SPZ)*, *Share (SPZ)*, *Master (PLY)*, with an SH-degree cap and an estimated file size.

### Viewer (PostShot and SuperSplat parity)
7. **Image Set camera mode.** Step through training photos from their poses and compare the render with each photo (split slider).
8. **Overlay toggles plus navigation.** Grid, axes and splat-count readout; Orbit/Ego with WASDQC; double-click to set the target.
9. **Crop box and training region of interest** with gizmos, then brush/rect/lasso selection (add/subtract/intersect) and automatic floater removal.

### Multi-workflow (see `project-multi-workflow`)
10. **Workflow picker** on the welcome screen and New Project sheet: cards for *Photos/Video → Splat*, *Single image → Splat (SHARP)*, *Depth maps (Depth Anything)*, *Pose-free (VGGT/DA3)*, *Open splat*. Each card shows input type, time, hardware and license badges.
11. **Engine swap per stage.** The existing "Engine" select generalizes to Poses: COLMAP / VGGT / DA3 and Train: Brush / gsplat.
12. **Fast path for one-shot models.** Drop an image, get a result in about a second, then *Promote to project*.
13. **Viewer view modes:** RGB / depth (colormap) / confidence / points + frustums, shared by every workflow.
14. **On-demand model installs** with license badges (SHARP and DA3-Large/Giant are non-commercial).

### Customization
15. Rebindable shortcuts. Saveable workspace layouts that survive updates. A gallery of shared theme JSON files.

Status of this pass: typecheck, tests (core 4, plugins 16) and the production build all pass.
