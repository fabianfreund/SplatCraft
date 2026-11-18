import { Activity, Box, Images, LayoutList, Play, Settings2, SkipForward, SlidersHorizontal, Sparkle, Square } from 'lucide-react';
import { useApp, type UiMode, type WorkspaceTab } from '../../store/app';
import { descriptorFor, effectiveSelectedKey, usePipeline } from '../../store/pipeline';
import { shortTitle } from '../../lib/steps';
import { Button, Divider, IconButton, SegmentedControl } from '../../ui';
import { MessagesButton } from './MessagesButton';
import { ProjectMenu } from './ProjectMenu';

const SLOT = 112;

export function TopBar() {
  const info = useApp((s) => s.info);
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const setToolsOpen = useApp((s) => s.setToolsOpen);
  const noSources = useApp((s) => (s.project?.meta.sources.length ?? 0) === 0);
  const isMac = (info?.platform ?? 'darwin') === 'darwin';

  return (
    <header className="drag relative flex h-[var(--sc-topbar-h)] shrink-0 items-center gap-2 border-b border-line bg-surface-1 pr-3" style={{ paddingLeft: isMac ? 'var(--sc-traffic-lights-w)' : 12 }}>
      <ProjectMenu />

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <SegmentedControl<WorkspaceTab>
          ariaLabel="View"
          size="sm"
          segmentWidth={92}
          value={tab}
          options={[
            { value: 'gallery', label: 'Gallery', icon: Images },
            { value: 'viewer', label: 'Viewer', icon: Box },
          ]}
          onChange={(t) => setTab(t)}
        />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <MessagesButton />
        <IconButton icon={Activity} label="Monitor" size="md" active={tab === 'monitor'} onClick={() => setTab(tab === 'monitor' ? 'gallery' : 'monitor')} tooltipSide="bottom" />
        <IconButton icon={LayoutList} label="Runs" size="md" active={tab === 'runs'} onClick={() => setTab(tab === 'runs' ? 'gallery' : 'runs')} tooltipSide="bottom" />
        <IconButton icon={Settings2} label="Tools & Add-ons" size="md" onClick={() => setToolsOpen(true)} tooltipSide="bottom" />
        <SegmentedControl<UiMode>
          ariaLabel="Mode"
          size="sm"
          segmentWidth={30}
          value={mode}
          options={[
            { value: 'simple', icon: Sparkle, tooltip: 'Simple' },
            { value: 'advanced', icon: SlidersHorizontal, tooltip: 'Advanced' },
          ]}
          onChange={setMode}
        />
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
