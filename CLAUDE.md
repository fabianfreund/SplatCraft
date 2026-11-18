# SplatCraft: agent guide

Open-source Electron studio for Gaussian splatting: media → review → align (COLMAP) → train (Brush) → export. pnpm monorepo, TypeScript everywhere.

## Commands
```bash
pnpm install
pnpm dev                                    # Electron app with HMR
pnpm --filter @splatcraft/desktop dev:web   # renderer only, in the browser with mock data (port 5199, ?kit = UI kit)
pnpm typecheck && pnpm test                 # run both before every commit
pnpm cli run <project> --preset fast        # headless pipeline
pnpm release:mac                            # signed + notarized DMGs → GitHub release (see docs/RELEASING.md)
node scripts/make-icons.mjs                 # regenerate every icon from apps/desktop/build/icon-source.png
```
Screenshot of the real app without a display loop: `SPLATCRAFT_SCREENSHOT=/abs/out.png [SPLATCRAFT_OPEN_PROJECT=/abs/x.splatcraft] electron .` from `apps/desktop` after `electron-vite build`. It quits right away if another SplatCraft instance is running, because of the single-instance lock. `SPLATCRAFT_SELFTEST=/abs/dir` exercises the IPC handlers (see `src/main/verify.ts`).

## Where things live
| Path | What |
|---|---|
| `packages/core` | project model, plugin registry, pipeline engine (content-hash cache, resume, cancel). No Electron imports. |
| `packages/plugins` | built-in stages: `media`, `quality`, `colmap`, `brush`, `export`, `monitor`, and `pipeline` (workflow templates) |
| `packages/toolchain` | finds / downloads external tools (ffmpeg, colmap, brush) |
| `packages/cli` | headless runner |
| `apps/desktop/src/main` | Electron main: window, menu, IPC allowlist (`ipc.ts`), services (projects, pipeline, monitor, previews) |
| `apps/desktop/src/preload` | `window.splatcraft` bridge, which implements `SplatCraftAPI` from `src/shared/api.ts` |
| `apps/desktop/src/renderer/src` | React UI: `ui/` primitives, `components/` features, `store/` (Zustand), `viewer/` (three.js + Spark), `lib/mock/` (browser mock of the bridge) |
| `docs/` | `ARCHITECTURE.md` (built vs planned), `RESEARCH.md`, `design/UI-REVIEW.md` (UI audit + roadmap), `RELEASING.md` |

Workspace packages ship raw TS (`main: src/index.ts`) and are bundled by electron-vite. `sharp` stays external (native module).

## Conventions
- **New bridge call:** add it to `SplatCraftAPI` + `IPC` in `src/shared/api.ts`, then the preload, the main handler (allowlisted in `ipc.ts`) and `lib/mock/mockApi.ts`, so `dev:web` keeps working.
- **New pipeline step:** a `defineStage` in a plugin. Steps connect by artifact kind, and the zod params schema drives both validation and the Advanced UI. Keep the UI workflow-agnostic: never hard-code media/align/train in the renderer.
- **UI:** follow `apps/desktop/src/renderer/src/ui/README.md`. Use tokens only (`styles/tokens.css`), no descriptive text (use `HelpTip`/tooltips), zero layout shift. Simple and Advanced share one layout, and Advanced only adds things.
- **Versions:** all `package.json` files share one version. Bump them together.
- Work goes to `main` through short-lived branches.
