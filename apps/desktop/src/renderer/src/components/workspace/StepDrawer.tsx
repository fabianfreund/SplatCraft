import { RotateCw, SlidersHorizontal } from 'lucide-react';
import { formatDuration, formatStat, humanize } from '../../lib/format';
import { shortTitle } from '../../lib/steps';
import { alternativesFor, descriptorFor, effectiveSelectedKey, stepStatus, usePipeline } from '../../store/pipeline';
import { PANEL_LIMITS, usePrefs } from '../../store/prefs';
import { Button, EmptyState, ResizeHandle, Field, HelpTip, Label, Select, StatusChip, Switch, Text } from '../../ui';
import { ParamForm } from '../params/ParamForm';

/** Advanced-mode drawer: parameters of the selected step. */
export function StepDrawer() {
  const spec = usePipeline((s) => s.spec);
  const stages = usePipeline((s) => s.stages);
  const steps = usePipeline((s) => s.steps);
  const plan = usePipeline((s) => s.plan);
  const running = usePipeline((s) => s.running);
  const key = usePipeline((s) => effectiveSelectedKey(s));
  const updateStep = usePipeline((s) => s.updateStep);
  const run = usePipeline((s) => s.run);
  const st = spec?.steps.find((x) => x.key === key);
  const d = st ? descriptorFor(stages, st.stageId) : undefined;
  const alts = st ? alternativesFor(stages, st.stageId) : [];
  const { status, rt, stats } = st ? stepStatus({ steps, plan }, st.key, st.enabled) : { status: 'idle' as const, rt: undefined, stats: undefined };
  const idx = spec && st ? spec.steps.indexOf(st) + 1 : 0;
  const setPrefs = usePrefs((s) => s.set);

  return (
    <aside className="relative flex w-[var(--sc-drawer-w)] shrink-0 flex-col border-l border-line bg-surface-1" style={{ animation: 'sc-fade-in var(--sc-duration-base) var(--sc-ease-out)' }}>
      <ResizeHandle edge="left" min={PANEL_LIMITS.drawer[0]} max={PANEL_LIMITS.drawer[1]} onResize={(drawerW) => setPrefs({ drawerW })} onReset={() => setPrefs({ drawerW: undefined })} />
      {!st || !spec ? (
        <EmptyState icon={SlidersHorizontal} title="No Step Selected" className="flex-1" />
      ) : (
        <>
          <header className="flex h-14 shrink-0 items-center gap-2 px-4">
            <Text size="lg" weight="semibold" num className="w-5 text-fg-faint">
              {idx}
            </Text>
            <Text size="lg" weight="semibold" truncate>
              {shortTitle(d, st.key)}
            </Text>
            <HelpTip text={d ? `${d.title} — ${d.description}` : undefined} />
            <span className="ml-auto">
              <StatusChip status={status} fraction={rt?.fraction} />
            </span>
          </header>
          <div className="scroll-stable flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4">
            {/* Results: reserved block, dashes until the step has run */}
            <div className="grid min-h-[44px] grid-cols-3 gap-2 rounded-lg bg-surface-2 p-2.5">
              {(() => {
                const entries = stats ? Object.entries(stats).filter(([k]) => !k.startsWith('rejected_')).slice(0, 5) : [];
                const cells: [string, string][] = entries.map(([k, v]) => [humanize(k), formatStat(v)]);
                if (rt?.durationMs !== undefined) cells.push(['Time', formatDuration(rt.durationMs)]);
                else if (status === 'running') {
                  if (rt?.fraction !== undefined) cells.push(['Progress', `${Math.round(rt.fraction * 100)}%`]);
                  if (rt?.startedAt) cells.push(['Elapsed', formatDuration(Date.now() - rt.startedAt)]);
                }
                if (!cells.length) cells.push(['Result', '—'], ['Time', '—']);
                return cells.map(([label, value], i) => (
                  <div key={i} className="flex min-w-0 flex-col">
                    <span className={`tnum ellipsis text-sm font-medium ${value === '—' ? 'text-fg-faint' : 'text-fg'}`}>{value}</span>
                    <span className="ellipsis text-2xs text-fg-subtle">{label}</span>
                  </div>
                ));
              })()}
            </div>
            <div className="flex flex-col gap-1">
              <Label>Step</Label>
              <Field label="Enabled">
                <Switch size="sm" checked={st.enabled} onChange={(enabled) => updateStep(st.key, { enabled })} label="Enabled" />
              </Field>
              {alts.length > 1 && (
                <Field label="Engine" help="Interchangeable stages with the same inputs and outputs.">
                  <Select size="sm" className="flex-1" value={st.stageId} options={alts.map((a) => ({ value: a.id, label: a.title }))} onChange={(stageId) => updateStep(st.key, { stageId, params: {} })} />
                </Field>
              )}
            </div>
            {d && (
              <div className="flex flex-col gap-1">
                <Label>Parameters</Label>
                <ParamForm descriptor={d} preset={spec.preset} params={st.params} onChange={(params) => updateStep(st.key, { params })} />
              </div>
            )}
          </div>
          <footer className="flex h-14 shrink-0 items-center px-4">
            <Button size="sm" variant="subtle" icon={RotateCw} className="w-full" disabled={running || !st.enabled} onClick={() => void run({ untilKey: st.key, force: [st.key] }, 'step')}>
              Force re-run
            </Button>
          </footer>
        </>
      )}
    </aside>
  );
}
