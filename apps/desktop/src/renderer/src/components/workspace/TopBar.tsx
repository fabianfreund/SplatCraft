import { Activity, Box, Images, LayoutList, Maximize2, Minimize2, Play, Settings, SkipForward, SlidersHorizontal, Sparkle, Square, type LucideIcon } from 'lucide-react';
import { useApp, VIEWS, type UiMode, type WorkspaceTab } from '../../store/app';
import { descriptorFor, effectiveSelectedKey, usePipeline } from '../../store/pipeline';
import { shortTitle } from '../../lib/steps';
import { Button, Divider, IconButton, SegmentedControl } from '../../ui';
import { MessagesButton } from './MessagesButton';
import { ProjectMenu } from './ProjectMenu';

const SLOT = 112;
const VIEW_META: Record<WorkspaceTab, { label: string; icon: LucideIcon }> = {
  gallery: { label: 'Gallery', icon: Images },
  viewer: { label: 'Viewer', icon: Box },
  monitor: { label: 'Monitor', icon: Activity },
  runs: { label: 'Runs', icon: LayoutList },
};

/**
 * Top bar: project · views · (messages, settings, mode) · run.
 * Advanced mode only appends views; nothing else moves.
 */
export function TopBar() {
  const info = useApp((s) => s.info);
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const setSettings = useApp((s) => s.setSettings);
  const chromeHidden = useApp((s) => s.chromeHidden);
  const toggleChrome = useApp((s) => s.toggleChrome);
  const noSources = useApp((s) => (s.project?.meta.sources.length ?? 0) === 0);
  const isMac = (info?.platform ?? 'darwin') === 'darwin';

  return (
    <header className="drag relative flex h-[var(--sc-topbar-h)] shrink-0 items-center gap-2 border-b border-line bg-surface-1 pr-3" style={{ paddingLeft: isMac ? 'var(--sc-traffic-lights-w)' : 12 }}>
      <div className="flex min-w-0 flex-1 basis-0 items-center gap-2">
        <ProjectMenu />
        <Divider vertical className="mx-0.5 h-4" />
        <SegmentedControl<UiMode>
          ariaLabel="Mode"
          size="sm"
          value={mode}
          options={[
            { value: 'simple', label: 'Simple', icon: Sparkle },
            { value: 'advanced', label: 'Advanced', icon: SlidersHorizontal },
          ]}
          onChange={setMode}
        />
      </div>

      <div className="flex shrink-0 justify-center">
        <SegmentedControl<WorkspaceTab>
          ariaLabel="View"
          size="sm"
          value={tab}
          options={VIEWS[mode].map((v) => ({ value: v, ...VIEW_META[v] }))}
          onChange={(t) => setTab(t)}
        />
      </div>

      <div className="flex flex-1 basis-0 items-center justify-end gap-1">
        <IconButton icon={chromeHidden ? Minimize2 : Maximize2} label={chromeHidden ? 'Show panels (\\)' : 'Focus mode (\\)'} size="md" active={chromeHidden} onClick={toggleChrome} tooltipSide="bottom" />
        <MessagesButton />
        <IconButton icon={Settings} label="Settings (⌘,)" size="md" onClick={() => setSettings('general')} tooltipSide="bottom" />
        <Divider vertical className="mx-1.5" />
        <RunButtons disabled={noSources} />
      </div>
    </header>
  );
}

/** Two fixed-width slots; the one that started a run becomes Stop. */
function RunButtons({ disabled }: { disabled: boolean }) {
  const running = usePipeline((s) => s.running);
  const stopping = usePipeline((s) => s.stopping);
  const origin = usePipeline((s) => s.runOrigin);
  const run = usePipeline((s) => s.run);
  const cancel = usePipeline((s) => s.cancel);
  const selected = usePipeline((s) => effectiveSelectedKey(s));
  const spec = usePipeline((s) => s.spec);
  const stages = usePipeline((s) => s.stages);
  const step = spec?.steps.find((x) => x.key === selected);
  const stepTitle = step ? shortTitle(descriptorFor(stages, step.stageId), step.key) : undefined;
  const stopIn: 'step' | 'all' = origin === 'step' ? 'step' : 'all';

  const stop = (
    <Button variant="danger" icon={Square} minWidth={SLOT} loading={stopping} onClick={() => void cancel()}>
      Stop
    </Button>
  );
  return (
    <div className="flex items-center gap-1.5">
      {running && stopIn === 'step' ? (
        stop
      ) : (
        <Button
          variant="secondary"
          icon={SkipForward}
          minWidth={SLOT}
          disabled={disabled || running || !step?.enabled}
          tooltip={stepTitle ? `Run up to ${stepTitle}` : undefined}
          onClick={() => selected && void run({ untilKey: selected }, 'step')}
        >
          Run step
        </Button>
      )}
      {running && stopIn === 'all' ? (
        stop
      ) : (
        <Button variant="primary" icon={Play} minWidth={SLOT} disabled={disabled || running} onClick={() => void run(undefined, 'all')}>
          Run all
        </Button>
      )}
    </div>
  );
}
