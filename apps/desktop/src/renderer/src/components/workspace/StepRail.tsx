import type { PresetId } from '@shared/api';
import { MoreHorizontal, Power, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { PRESETS } from '../../lib/presets';
import { keyStat, shortTitle } from '../../lib/steps';
import { useApp } from '../../store/app';
import { PANEL_LIMITS, usePrefs } from '../../store/prefs';
import { HIDDEN_PARAM_KEYS } from '../../lib/schema';
import { descriptorFor, effectiveSelectedKey, stepStatus, usePipeline } from '../../store/pipeline';
import { StepNotices } from './StepNotices';
import { ContextMenu, IconButton, Label, RadioList, ResizeHandle, Skeleton, StepperItem, type ContextMenuState, type StepperState } from '../../ui';

/** Left rail: numbered vertical stepper + preset. */
export function StepRail() {
  const advanced = useApp((s) => s.mode === 'advanced');
  const sourcesCount = useApp((s) => s.project?.meta.sources.length ?? 0);
  const spec = usePipeline((s) => s.spec);
  const stages = usePipeline((s) => s.stages);
  const loaded = usePipeline((s) => s.stagesLoaded);
  const steps = usePipeline((s) => s.steps);
  const plan = usePipeline((s) => s.plan);
  const running = usePipeline((s) => s.running);
  const selected = usePipeline((s) => effectiveSelectedKey(s));
  const selectStep = usePipeline((s) => s.selectStep);
  const updateStep = usePipeline((s) => s.updateStep);
  const run = usePipeline((s) => s.run);
  const setPreset = usePipeline((s) => s.setPreset);
  const notices = usePipeline((s) => s.notices);
  const failure = usePipeline((s) => s.failure);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const setPrefs = usePrefs((s) => s.set);

  const rows = (spec?.steps ?? []).map((st) => {
    const d = descriptorFor(stages, st.stageId);
    const s = stepStatus({ steps, plan }, st.key, st.enabled);
    let state: StepperState = s.status === 'cached' || s.status === 'done' ? 'done' : (s.status as StepperState);
    // After a restart the failed step is simply "not cached": show it as failed.
    if (state === 'idle' && failure?.key === st.key) state = 'error';
    return { st, d, s, state };
  });

  return (
    <aside className="relative flex w-[var(--sc-rail-w)] shrink-0 flex-col border-r border-line bg-surface-1">
      <ResizeHandle edge="right" min={PANEL_LIMITS.rail[0]} max={PANEL_LIMITS.rail[1]} onResize={(railW) => setPrefs({ railW })} onReset={() => setPrefs({ railW: undefined })} />
      <div className="flex h-10 shrink-0 items-center px-4">
        <Label>Workflow</Label>
      </div>
      <ol className="scroll-stable flex min-h-0 flex-1 flex-col px-2">
        {!loaded || !spec
          ? Array.from({ length: 5 }, (_, i) => (
              <li key={i} className="flex h-[52px] items-center gap-3 px-2.5">
                <Skeleton width={24} height={24} className="rounded-full" />
                <Skeleton width="50%" height={11} />
              </li>
            ))
          : rows.map(({ st, d, s, state }, i) => {
              const isMedia = d?.category === 'prepare';
              const stat = keyStat(d?.category, s.stats);
              return (
                <li key={st.key}>
                  <StepperItem
                    index={i + 1}
                    title={shortTitle(d, st.key)}
                    help={d ? `${d.title} — ${d.description}` : undefined}
                    stat={stat ?? (isMedia && sourcesCount ? String(sourcesCount) : undefined)}
                    statMuted={!stat}
                    state={state}
                    fraction={s.rt?.fraction}
                    error={notices[st.key]?.find((n) => n.notice.level === 'error')?.notice.title ?? s.rt?.error ?? s.error}
                    indicator={<StepNotices title={shortTitle(d, st.key)} items={notices[st.key]} />}
                    selected={selected === st.key}
                    modified={Object.keys(st.params ?? {}).some((k) => !HIDDEN_PARAM_KEYS.has(k))}
                    doneBelow={state === 'done' && rows[i + 1]?.state === 'done'}
                    last={i === rows.length - 1}
                    onSelect={() => {
                      selectStep(st.key);
                      useApp.getState().focusStep(st.key, 'user');
                    }}
                    trailing={
                      advanced ? (
                        <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-aria-pressed:opacity-100">
                          <IconButton
                            icon={MoreHorizontal}
                            label="More"
                            size="xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              setMenu({
                                x: r.left,
                                y: r.bottom + 4,
                                items: [
                                  { label: 'Force re-run', icon: RotateCw, disabled: running || !st.enabled, onSelect: () => void run({ untilKey: st.key, force: [st.key] }, 'step') },
                                  { label: st.enabled ? 'Disable' : 'Enable', icon: Power, onSelect: () => updateStep(st.key, { enabled: !st.enabled }) },
                                ],
                              });
                            }}
                          />
                        </span>
                      ) : undefined
                    }
                  />
                </li>
              );
            })}
      </ol>
      <div className="flex shrink-0 flex-col gap-2 px-4 pb-4 pt-2">
        <Label>Preset</Label>
        <RadioList<PresetId>
          ariaLabel="Preset"
          value={spec?.preset ?? 'balanced'}
          disabled={running}
          options={PRESETS.map((p) => ({ value: p.id, label: p.title, icon: p.icon, meta: p.meta, help: p.help }))}
          onChange={(p) => void setPreset(p)}
        />
      </div>
      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </aside>
  );
}
