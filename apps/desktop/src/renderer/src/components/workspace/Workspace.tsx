import { Upload } from 'lucide-react';
import { useEffect } from 'react';
import { useMessages } from '../../store/messages';
import { useApp } from '../../store/app';
import { cn, EmptyState } from '../../ui';
import { FailureOverlay } from './FailureOverlay';
import { Gallery } from './Gallery';
import { MonitorTab } from './MonitorTab';
import { RunsTab } from './RunsTab';
import { StatusDock } from './StatusDock';
import { StepDrawer } from './StepDrawer';
import { StepRail } from './StepRail';
import { ToolsDialog } from './ToolsDialog';
import { TopBar } from './TopBar';
import { useWindowDrop } from './useDrop';
import { ViewerPane } from './ViewerPane';

export function Workspace() {
  const tab = useApp((s) => s.tab);
  const dir = useApp((s) => s.project?.dir);
  useEffect(() => useMessages.getState().setScope(dir), [dir]);
  const advanced = useApp((s) => s.mode === 'advanced');
  const dragging = useWindowDrop();
  return (
    <div className="flex h-full flex-col bg-bg">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <StepRail />
        <main className="relative min-w-0 flex-1">
          {/* The viewer stays mounted (keeps the WebGL context + camera). */}
          <div className={cn('absolute inset-0', tab !== 'viewer' && 'invisible')}>
            <ViewerPane />
          </div>
          {tab === 'gallery' && <Gallery />}
          {tab === 'monitor' && <MonitorTab />}
          {tab === 'runs' && <RunsTab />}
          {(tab === 'gallery' || tab === 'viewer') && <FailureOverlay />}
        </main>
        {advanced && <StepDrawer />}
      </div>
      <StatusDock />
      <ToolsDialog />
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[950] flex items-center justify-center bg-overlay p-6 backdrop-blur-sm" style={{ animation: 'sc-fade-in var(--sc-duration-fast) var(--sc-ease-out)' }}>
          <div className="flex size-full items-center justify-center rounded-xl border-2 border-dashed border-accent bg-surface-1 shadow-glow">
            <EmptyState icon={Upload} title="Drop to Add Media" size="lg" />
          </div>
        </div>
      )}
    </div>
  );
}
