# SplatCraft UI library

`ui/` holds the primitives. Feature code in `components/` only composes them and never styles raw elements with ad-hoc colors.

## Rules
1. **Tokens only.** Colors, type, radii, sizes, shadows and motion live in `styles/tokens.css`. Tailwind's default palette is disabled (`styles/app.css`), so only token classes exist (`bg-surface-2`, `text-fg-muted`, `border-line`, `text-accent` …).
2. **No descriptive text.** Explanations go in a `HelpTip` (the "?" icon) or the `tooltip` prop.
3. **No layout shift.** Fixed row and control heights, reserved slots (e.g. `IconButton … className="invisible"`), tabular numbers (`tnum`), and skeletons with the final size.
4. **Accessible by default.** Every icon-only control needs a `label`; selection controls use `radio`, `switch` or `option` roles.

## Token layers (`styles/tokens.css`)
| Layer | Set by | Examples |
|---|---|---|
| 1. Inputs | `store/prefs.ts` (inline on `<html>`) | `--sc-accent`, `--sc-accent-ink`, `--sc-text-scale` |
| 2. Theme | `data-theme="dark\|light"` | surfaces, lines, ink, status, viewer colors |
| 3. Derived | `color-mix()` from layers 1–2, never per theme | `--sc-accent-soft`, `--sc-line-focus`, `--sc-shadow-glow` |
| 4. Density | `data-density="compact\|default\|comfortable"` | `--sc-control-h`, `--sc-row-h`, `--sc-rail-w` |

`data-motion="reduced"` sets every duration to zero. The 3D viewer reads its `--sc-viewer-*` tokens and refreshes them on the `sc-theme-change` window event.

## User customization
Everything is under **Settings → Appearance** (`components/settings/SettingsDialog.tsx`):
- **Theme:** dark, light or system.
- **Accent:** six calm presets plus a custom color. Ink and light-theme contrast are computed automatically.
- **Density** and **text size**.
- **Reduced motion.**
- **Resizable panels:** drag a panel edge, double-click to reset. Widths are stored in prefs.
- **Custom themes:** *Copy* exports `{ theme, accent, tokens }` as JSON; edit any `--sc-*` value and *Paste* it back. Only `--sc-*` keys are accepted.

```json
{ "theme": "dark", "accent": "#7fa6e3", "tokens": { "--sc-bg": "#0a0b10", "--sc-surface-1": "#10121a" } }
```

## UI kit
`pnpm --filter @splatcraft/desktop dev:web`, then open `http://localhost:5199/?kit`. This is the browser preview with a mock bridge; `dev/UiKit.tsx` renders every primitive with theme, density and accent switchers. Add new primitives there.

## Adding a primitive
1. Create `ui/MyThing.tsx`. Use token classes only and fixed sizes, and take `className` for layout tweaks.
2. Export it from `ui/index.ts` (keep the list alphabetical).
3. Add it to `dev/UiKit.tsx`.
4. If it needs a new color or size, add a token in the right layer of `tokens.css` and map it in `app.css` (`@theme inline`) instead of hard-coding it.

## Catalog
| Group | Primitives |
|---|---|
| Actions | `Button`, `IconButton`, `ActionButton` |
| Choice | `SegmentedControl`, `RadioList`, `ChipGroup`, `ChoiceCard`, `Switch`, `Select`, `SwatchPicker` |
| Input | `Input`, `Textarea`, `TagInput`, `NumberField`, `Slider` |
| Canvas | `Toolbar`, `ToolbarButton`, `ToolbarDivider` (floating Figma-style pill) |
| Layout | `Panel`, `Section`, `Field`, `Stat`, `Divider`, `ResizeHandle`, `NavList` |
| Overlay | `Dialog`, `Sheet`, `Popover`, `ContextMenu`, `Tooltip`, `HelpTip`, `Toast` |
| Status | `Badge`, `StatusChip`, `ProgressBar`, `Spinner`, `Skeleton`, `Meter`, `Sparkline`, `Callout`, `LevelDot`, `MessageList` |
| Content | `Text`, `Label`, `Kbd`, `EmptyState`, `ListRow`, `Table`, `Thumb`, `ImageTile`, `StepperItem` |
