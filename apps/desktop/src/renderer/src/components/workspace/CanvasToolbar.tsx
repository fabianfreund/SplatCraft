/**
 * Figma-style floating toolbar at the bottom of the canvas.
 *
 *   [ view tools ]  |  [ step actions ]  |  [ primary ]
 *
 * View tools depend on the visible view (gallery / viewer). Step actions and the
 * primary action depend on the selected step's category — see STEP_ACTIONS.
 * A new workflow stage only needs an entry there.
 */
import type { PipelineSpec, PresetId, StageDescriptor } from '@shared/api';
import {
  Aperture,
  ArrowRight,
  Camera,
  Copy,
  Download,
  Eraser,
  FastForward,
  Focus,
  FolderOpen,
  FolderPlus,
  Gem,
  ImageDown,
  Crosshair,
  LandPlot,
  Play,
  RotateCw,
  Ruler,
  Sparkles,
  Square,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { formatNumber } from '../../lib/format';
import { fieldsFromSchema } from '../../lib/schema';
import { shortTitle } from '../../lib/steps';
import { useApp } from '../../store/app';
import { pushMessage } from '../../store/messages';
import { descriptorFor, effectiveSelectedKey, reviewStepKey, stepStatus, usePipeline } from '../../store/pipeline';
import { useViewer } from '../../store/viewer';
import { alignmentStepKey, useEdit, type EditTool } from '../../store/edit';
import { currentTracks, tieStepKey, useTiePoints } from '../../store/tiepoints';
import { Slider, Toolbar, ToolbarButton, ToolbarDivider, ToolbarSection, ToolbarToggleGroup, Tooltip, type ToolbarToggle } from '../../ui';
import { addSources } from './useDrop';

type Step = PipelineSpec['steps'][number];

interface Ctx {
  step: Step;
  descriptor?: StageDescriptor;
  preset: PresetId;
  done: boolean;
  running: boolean;
  stats?: Record<string, number | string>;
  projectDir: string;
  run(opts?: { untilKey?: string; force?: string[] }, origin?: 'step' | 'all'): void;
  /** Merges param overrides into the step. */
  setParams(patch: Record<string, unknown>): void;
  /** Effective value: override → preset → schema default. */
  param(key: string): unknown;
  /** The step owns the scene alignment (ground / scale tools apply). */
  alignable: boolean;
  /** Something is shown in the 3D view that points can be picked on. */
  pickable: boolean;
  tool: EditTool | null;
  setTool(t: EditTool | null): void;
  /** Feature points can be placed here (frames exist and a step takes them). */
  pointable: boolean;
  pointing: boolean;
  /** Number of feature points (tracks). */
  points: number;
  setPointing(on: boolean): void;
  clearPoints(): void;
}

interface Action {
  id: string;
  icon: LucideIcon;
  label: string;
  text?: string;
  disabled?: boolean;
  onClick(): void;
}

interface StepTools {
  /** Modal canvas tools (toggles), shown before the actions. */
  tools?(c: Ctx): ToolbarToggle[];
  actions(c: Ctx): Action[];
  primary(c: Ctx): Action;
}

/** Trainers name the same knobs differently; the first key the step has wins. */
const STEPS_KEYS = ['totalSteps', 'steps', 'iterations'];
const SPLATS_KEYS = ['maxSplats', 'capMax', 'maxGaussians'];
const firstKey = (c: Ctx, keys: string[]) => keys.find((k) => num(c.param(k)) !== undefined);

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const short = (v: number) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : formatNumber(v));

const rerun = (c: Ctx, label: string): Action => ({ id: 'rerun', icon: RotateCw, label, disabled: c.running || !c.step.enabled, onClick: () => c.run({ untilKey: c.step.key, force: [c.step.key] }, 'step') });
const runThis = (c: Ctx, text: string): Action => ({ id: 'run', icon: Play, label: `Run up to ${text}`, text, disabled: !c.step.enabled, onClick: () => c.run({ untilKey: c.step.key }, 'step') });
const proceed = (c: Ctx, text = 'Continue'): Action => ({ id: 'continue', icon: ArrowRight, label: 'Run the remaining steps', text, onClick: () => c.run(undefined, 'all') });

/** Feature points: on the frame-review step and on the step that takes them (alignment). */
const pointsTool = (c: Ctx): ToolbarToggle[] =>
  c.pointable
    ? [{ id: 'points', icon: Crosshair, label: 'Feature points · open a frame and click the same spot in several frames', shortcut: 'P', active: c.pointing, disabled: c.running, onToggle: () => c.setPointing(!c.pointing) }]
    : [];
const clearPointsAction = (c: Ctx): Action[] =>
  c.pointable ? [{ id: 'clear-points', icon: Eraser, label: `Clear feature points${c.points ? ` (${c.points})` : ''}`, disabled: !c.points || c.running, onClick: c.clearPoints }] : [];

export const STEP_ACTIONS: Record<string, StepTools> = {
  prepare: {
    actions: (c) => [rerun(c, 'Re-extract frames')],
    primary: (c) => (c.done ? proceed(c) : runThis(c, 'Extract')),
  },
  filter: {
    tools: (c) => pointsTool(c),
    actions: (c) => {
      const ex = (c.step.params.excluded as string[] | undefined)?.length ?? 0;
      const inc = (c.step.params.included as string[] | undefined)?.length ?? 0;
      return [
        { id: 'reset', icon: Undo2, label: `Reset manual picks${ex + inc ? ` (${ex + inc})` : ''}`, disabled: !(ex + inc) || c.running, onClick: () => c.setParams({ excluded: [], included: [] }) },
        rerun(c, 'Re-score frames'),
        ...clearPointsAction(c),
      ];
    },
    primary: (c) => proceed(c),
  },
  align: {
    tools: (c) => pointsTool(c),
    actions: (c) => [...clearPointsAction(c), rerun(c, 'Re-align cameras')],
    primary: (c) => (c.done ? proceed(c) : runThis(c, 'Align')),
  },
  train: {
    actions: (c) => {
      const sk = firstKey(c, STEPS_KEYS);
      const pk = firstKey(c, SPLATS_KEYS);
      const steps = sk ? num(c.param(sk)) : undefined;
      const splats = pk ? num(c.param(pk)) : undefined;
      const idle = c.running || !c.step.enabled || !c.done;
      // Changing steps or splats gives the step a new cache key: training starts over at step 0.
      const out: Action[] = [rerun(c, 'Retrain from scratch')];
      if (sk && steps)
        out.push({
          id: 'more',
          icon: FastForward,
          label: `Retrain longer · ${short(steps)} → ${short(Math.round(steps * 1.5))} steps (from scratch)`,
          disabled: idle,
          onClick: () => {
            c.setParams({ [sk]: Math.round(steps * 1.5) });
            c.run({ untilKey: c.step.key }, 'step');
          },
        });
      if (sk && pk && steps && splats)
        out.push({
          id: 'detail',
          icon: Gem,
          label: `Retrain with more detail · ${short(splats)} → ${short(Math.round(splats * 1.5))} splats (from scratch)`,
          disabled: idle,
          onClick: () => {
            c.setParams({ [pk]: Math.round(splats * 1.5), [sk]: Math.round(steps * 1.25) });
            c.run({ untilKey: c.step.key }, 'step');
          },
        });
      return out;
    },
    primary: (c) => (c.done ? proceed(c, 'Export') : runThis(c, 'Train')),
  },
  export: {
    tools: (c) => {
      if (!c.alignable) return [];
      const toggle = (id: EditTool, icon: LucideIcon, label: string, shortcut: string): ToolbarToggle => ({
        id,
        icon,
        label,
        shortcut,
        active: c.tool === id,
        disabled: !c.pickable || c.running,
        onToggle: () => c.setTool(c.tool === id ? null : id),
      });
      return [toggle('ground', LandPlot, 'Set ground · pick 3 points', 'G'), toggle('measure', Ruler, 'Set scale · pick 2 points', 'M')];
    },
    actions: (c) => {
      const file = typeof c.stats?.file === 'string' ? `${c.projectDir}/${c.stats.file}` : undefined;
      return [
        { id: 'reveal', icon: FolderOpen, label: 'Show in folder', disabled: !file, onClick: () => file && void window.splatcraft.app.revealInFolder(file) },
        {
          id: 'copy',
          icon: Copy,
          label: 'Copy file path',
          disabled: !file,
          onClick: () => file && void navigator.clipboard.writeText(file).then(() => pushMessage({ level: 'info', title: 'Path copied' })),
        },
      ];
    },
    primary: (c) => ({
      id: 'export',
      icon: Download,
      label: `Export ${String(c.param('format') ?? 'ply').toUpperCase()}`,
      text: c.done ? 'Re-export' : 'Export',
      disabled: !c.step.enabled,
      onClick: () => c.run({ untilKey: c.step.key, force: c.done ? [c.step.key] : undefined }, 'step'),
    }),
  },
};
STEP_ACTIONS.refine = STEP_ACTIONS.train;

const FALLBACK: StepTools = { actions: (c) => [rerun(c, 'Re-run step')], primary: (c) => runThis(c, 'Run') };

export function CanvasToolbar() {
  const tab = useApp((s) => s.tab);
  const projectDir = useApp((s) => s.project?.dir ?? '');
  const hasSources = useApp((s) => (s.project?.meta.sources.length ?? 0) > 0);
  const spec = usePipeline((s) => s.spec);
  const stages = usePipeline((s) => s.stages);
  const steps = usePipeline((s) => s.steps);
  const plan = usePipeline((s) => s.plan);
  const running = usePipeline((s) => s.running);
  const stopping = usePipeline((s) => s.stopping);
  const key = usePipeline((s) => effectiveSelectedKey(s));
  const run = usePipeline((s) => s.run);
  const cancel = usePipeline((s) => s.cancel);
  const updateStep = usePipeline((s) => s.updateStep);
  const tool = useEdit((s) => s.tool);
  const hasContent = useViewer((s) => s.hasContent);
  const pointing = useTiePoints((s) => s.active);
  const hasFrames = usePipeline((s) => (s.previews.images?.paths.length ?? 0) > 0);

  const step = spec?.steps.find((x) => x.key === key);
  const descriptor = step ? descriptorFor(stages, step.stageId) : undefined;
  const fields = useMemo(() => (descriptor ? fieldsFromSchema(descriptor.paramsJsonSchema) : []), [descriptor]);

  if ((tab !== 'gallery' && tab !== 'viewer') || !spec || !step || !hasSources) return null;

  const status = stepStatus({ steps, plan }, step.key, step.enabled);
  const ctx: Ctx = {
    step,
    descriptor,
    preset: spec.preset,
    done: status.status === 'done' || status.status === 'cached',
    running,
    stats: status.stats,
    projectDir,
    run: (opts, origin) => void run(opts, origin),
    setParams: (patch) => updateStep(step.key, { params: { ...step.params, ...patch } }),
    param: (k) => (k in step.params ? step.params[k] : (descriptor?.presets[spec.preset]?.[k] ?? fields.find((f) => f.key === k)?.default)),
    alignable: alignmentStepKey(spec, stages) === step.key,
    pickable: hasContent,
    tool,
    setTool: (t) => {
      if (t) useApp.getState().setTab('viewer');
      useEdit.getState().setTool(t);
    },
    pointable: !!tieStepKey(spec, stages) && (tieStepKey(spec, stages) === step.key || reviewStepKey(spec, stages) === step.key) && hasFrames,
    pointing,
    points: currentTracks(spec, stages).length,
    setPointing: (on) => {
      if (on) {
        useApp.getState().setTab('gallery');
        useApp.getState().setGallery('frames');
      }
      useTiePoints.getState().setActive(on);
    },
    clearPoints: () => useTiePoints.getState().clear(),
  };
  const tools = STEP_ACTIONS[descriptor?.category ?? ''] ?? FALLBACK;
  const toggles = tools.tools?.(ctx) ?? [];
  const actions = tools.actions(ctx);
  const primary = tools.primary(ctx);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-6">
      <div className="pointer-events-auto">
        <Toolbar ariaLabel={`${shortTitle(descriptor, step.key)} tools`}>
          {tab === 'viewer' ? <ViewerTools /> : <GalleryTools />}
          <ToolbarDivider />
          <ToolbarSection key={step.key}>
            {toggles.length > 0 && (
              <>
                <ToolbarToggleGroup items={toggles} />
                <ToolbarDivider />
              </>
            )}
            {actions.map((a) => (
              <ToolbarButton key={a.id} icon={a.icon} label={a.label} disabled={a.disabled} onClick={a.onClick} />
            ))}
          </ToolbarSection>
          <ToolbarDivider />
          {running ? (
            <ToolbarButton icon={Square} label="Stop" text={stopping ? 'Stopping…' : 'Stop'} tone="danger" disabled={stopping} onClick={() => void cancel()} />
          ) : (
            <ToolbarButton icon={primary.icon} label={primary.label} text={primary.text} tone="primary" disabled={primary.disabled} onClick={primary.onClick} />
          )}
        </Toolbar>
      </div>
    </div>
  );
}

/** Point size on a log scale: the slider runs 2^-2 … 2^2 (¼× … 4×). */
function PointSizeSlider() {
  const size = useViewer((s) => s.pointSize);
  const setSize = useViewer((s) => s.setPointSize);
  return (
    <Tooltip content={`Point size · ${+size.toFixed(2)}×`} side="top">
      <div className="flex h-9 w-24 items-center px-2" onDoubleClick={() => setSize(1)}>
        <Slider min={-2} max={2} step={0.05} value={Math.log2(size)} changed={size !== 1} onChange={(v) => setSize(2 ** v)} />
      </div>
    </Tooltip>
  );
}

function ViewerTools() {
  const layers = useViewer((s) => s.layers);
  const setLayer = useViewer((s) => s.setLayer);
  const commands = useViewer((s) => s.commands);
  return (
    <>
      <ToolbarToggleGroup
        items={[
          { id: 'points', icon: Aperture, label: 'Points', active: layers.points, onToggle: () => setLayer('points', !layers.points) },
          { id: 'cameras', icon: Camera, label: 'Cameras', active: layers.cameras, onToggle: () => setLayer('cameras', !layers.cameras) },
          { id: 'splat', icon: Sparkles, label: 'Splat', active: layers.splat, onToggle: () => setLayer('splat', !layers.splat) },
        ]}
      />
      {layers.points && <PointSizeSlider />}
      <ToolbarDivider />
      <ToolbarButton icon={Focus} label="Reset view" disabled={!commands} onClick={() => commands?.resetView()} />
      <ToolbarButton icon={ImageDown} label="Screenshot" disabled={!commands} onClick={() => commands?.screenshot()} />
    </>
  );
}

function GalleryTools() {
  const dir = useApp((s) => s.project?.dir);
  return (
    <>
      <ToolbarButton icon={FolderPlus} label="Add photos or videos" onClick={() => void addSources()} />
      <ToolbarButton icon={FolderOpen} label="Show project folder" disabled={!dir} onClick={() => dir && void window.splatcraft.app.revealInFolder(dir)} />
    </>
  );
}
