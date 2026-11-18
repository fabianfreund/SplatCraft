import { useCallback, useEffect } from 'react';
import { NewProjectSheet } from './components/welcome/NewProjectSheet';
import { WelcomeWindow } from './components/welcome/WelcomeWindow';
import { Workspace } from './components/workspace/Workspace';
import { useApp } from './store/app';
import { useMonitor } from './store/monitor';
import { usePipeline } from './store/pipeline';
import { Spinner, Toast } from './ui';

export function App() {
  const booted = useApp((s) => s.booted);
  const project = useApp((s) => s.project);
  const error = useApp((s) => s.error);
  const setError = useApp((s) => s.setError);
  const clearError = useCallback(() => setError(undefined), [setError]);

  useEffect(() => {
    const cs = window.splatcraft;
    const offs = [
      cs.pipeline.onEvent((e) => {
        usePipeline.getState().apply(e);
        if (e.type === 'run.start') useApp.getState().resetAutoView();
        // First 3D preview of a run → switch Gallery to Viewer (unless the user chose a view).
        if (e.type === 'stage.preview' && ['pointcloud', 'cameras', 'splat'].includes(e.preview.kind)) useApp.getState().maybeAutoSwitch();
      }),
      cs.monitor.onSample((s) => useMonitor.getState().push(s)),
      cs.projects.onChanged((p) => useApp.getState().setProject(p)),
      cs.app.onMenuAction((a) => {
        const app = useApp.getState();
        if (a === 'project.new') app.setNewProjectOpen(true);
        else if (a === 'project.open') void app.openProject();
        else if (a === 'project.close') void app.closeProject();
        else if (a === 'app.settings') app.project ? app.setToolsOpen(true) : undefined;
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
      <Toast message={error} onClose={clearError} />
    </>
  );
}
