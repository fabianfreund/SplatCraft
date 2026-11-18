import { useCallback, useEffect } from 'react';
import { NewProjectSheet } from './components/welcome/NewProjectSheet';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { WelcomeWindow } from './components/welcome/WelcomeWindow';
import { Workspace } from './components/workspace/Workspace';
import { useApp } from './store/app';
import { useMonitor } from './store/monitor';
import { descriptorFor, usePipeline } from './store/pipeline';
import { LoadingOverlay, Spinner, Toast } from './ui';

/** Step the run last moved the selection to (see stage.start below). */
let following: string | undefined;

export function App() {
  const booted = useApp((s) => s.booted);
  const project = useApp((s) => s.project);
  const error = useApp((s) => s.error);
  const setError = useApp((s) => s.setError);
  const opening = useApp((s) => s.opening);
  const clearError = useCallback(() => setError(undefined), [setError]);

  useEffect(() => {
    const cs = window.splatcraft;
    const offs = [
      cs.pipeline.onEvent((e) => {
        usePipeline.getState().apply(e);
        // Each started step takes focus (inspector, view, view content) while the user follows
        // the run. Selecting another step by hand stops following until the next run.
        if (e.type === 'run.start') {
          useApp.getState().resetAutoView();
          following = usePipeline.getState().selectedKey;
        }
        // Extraction finished → show its result (the frames) instead of the inputs.
        if (e.type === 'stage.done' && useApp.getState().gallery === 'sources') {
          const p = usePipeline.getState();
          const st = p.spec?.steps.find((x) => x.key === e.key);
          if (st && descriptorFor(p.stages, st.stageId)?.category === 'prepare') useApp.getState().setGallery('frames');
        }
        if (e.type === 'stage.start') {
          const sel = usePipeline.getState().selectedKey;
          if (sel === undefined || sel === following) {
            following = e.key;
            usePipeline.getState().selectStep(e.key);
            useApp.getState().focusStep(e.key, 'auto');
          }
        }
      }),
      cs.monitor.onSample((s) => useMonitor.getState().push(s)),
      cs.projects.onChanged((p) => useApp.getState().setProject(p)),
      cs.app.onMenuAction((a) => {
        const app = useApp.getState();
        if (a === 'project.new') app.setNewProjectOpen(true);
        else if (a === 'project.open') void app.openProject();
        else if (a === 'project.close') void app.closeProject();
        else if (a === 'app.settings') app.setSettings('general');
      }),
    ];
    void cs.monitor.history().then((h) => useMonitor.getState().seed(h));
    void useApp.getState().boot().catch((e) => setError(String(e)));
    return () => offs.forEach((off) => off());
  }, [setError]);

  return (
    <>
      {!booted ? (
        <div className="drag flex h-full items-center justify-center text-fg-subtle">
          <Spinner size={18} />
        </div>
      ) : project ? (
        <Workspace />
      ) : (
        <WelcomeWindow />
      )}
      <NewProjectSheet />
      <SettingsDialog />
      <LoadingOverlay scope="app" show={opening} label="Opening project" />
      <Toast message={error} onClose={clearError} />
    </>
  );
}
