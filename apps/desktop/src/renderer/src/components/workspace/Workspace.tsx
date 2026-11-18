import { Upload } from 'lucide-react';
import { useEffect } from 'react';
import { useMessages } from '../../store/messages';
import { useApp } from '../../store/app';
import { cn, EmptyState, LoadingOverlay } from '../../ui';
import { usePipeline } from '../../store/pipeline';
import { CanvasToolbar } from './CanvasToolbar';
import { FailureOverlay } from './FailureOverlay';
import { Gallery } from './Gallery';
import { MonitorTab } from './MonitorTab';
import { RunsTab } from './RunsTab';
import { StatusDock } from './StatusDock';
import { StepDrawer } from './StepDrawer';
import { StepRail } from './StepRail';
import { TopBar } from './TopBar';
import { useWindowDrop } from './useDrop';
import { ViewerPane } from './ViewerPane';

/** Global workspace shortcuts: \\ = focus mode, ⌘, = settings. */
function useWorkspaceKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      const app = useApp.getState();
      if (e.key === '\\' && !e.metaKey && !e.ctrlKey && !app.settings) {
        e.preventDefault();
        app.toggleChrome();
      } else if (e.key === ',' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        app.setSettings('general');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function Workspace() {
  const tab = useApp((s) => s.tab);
  const dir = useApp((s) => s.project?.dir);
  useEffect(() => useMessages.getState().setScope(dir), [dir]);
  const advanced = useApp((s) => s.mode === 'advanced');
  const chromeHidden = useApp((s) => s.chromeHidden);
  const preparing = usePipeline((s) => !s.stagesLoaded);
  const dragging = useWindowDrop();
  useWorkspaceKeys();
  return (
    <div className="flex h-full flex-col bg-bg">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {!chromeHidden && <StepRail />}
        <main className="relative min-w-0 flex-1">
          {/* The viewer stays mounted (keeps the WebGL context + camera). */}
          <div inert={tab !== 'viewer'} className={cn('absolute inset-0 transition-opacity duration-200 ease-out', tab !== 'viewer' && 'pointer-events-none opacity-0')}>
            <ViewerPane />
          </div>
          {tab === 'gallery' && <Gallery />}
          {tab === 'monitor' && <MonitorTab />}
          {tab === 'runs' && <RunsTab />}
          {(tab === 'gallery' || tab === 'viewer') && <FailureOverlay />}
          <CanvasToolbar />
          <LoadingOverlay show={preparing} label="Preparing workspace" />
        </main>
        {advanced && !chromeHidden && <StepDrawer />}
      </div>
      {!chromeHidden && <StatusDock />}
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
