import { Cuboid, MonitorX, Play, Sparkles, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../store/app';
import { pushMessage } from '../../store/messages';
import { usePipeline } from '../../store/pipeline';
import { useViewer } from '../../store/viewer';
import { Badge, Button, EmptyState, LoadingOverlay, Spinner } from '../../ui';
import { SparkViewer } from '../../viewer/SparkViewer';
import type { ViewerAPI } from '../../viewer/ViewerAPI';
import { EditOverlay } from './edit/EditOverlay';
import { useEditViewer } from './edit/useEditViewer';

const bust = (url: string, v: number | string) => (url.startsWith('blob:') || url.startsWith('data:') ? url : `${url}${url.includes('?') ? '&' : '?'}v=${v}`);

export function ViewerPane() {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<ViewerAPI | null>(null);
  const [failed, setFailed] = useState(false);
  const projectDir = useApp((s) => s.project?.dir);
  const hasSources = useApp((s) => (s.project?.meta.sources.length ?? 0) > 0);
  const previews = usePipeline((s) => s.previews);
  const running = usePipeline((s) => s.running);
  const run = usePipeline((s) => s.run);
  const { layers, loading, shownStep, hasContent, set } = useViewer();

  // Mount once.
  useEffect(() => {
    if (!host.current) return;
    try {
      viewer.current = new SparkViewer(host.current);
      viewer.current.setLayers(useViewer.getState().layers);
    } catch (e) {
      pushMessage({ level: 'error', title: '3D viewer unavailable', detail: String((e as Error)?.message ?? e), hint: 'WebGL 2 is required.' });
      setFailed(true);
    }
    return () => {
      viewer.current?.dispose();
      viewer.current = null;
    };
  }, []);

  // New project → clear.
  useEffect(() => {
    viewer.current?.clear();
    set({ hasContent: false, shownStep: undefined, loading: false });
  }, [projectDir, set]);

  useEffect(() => viewer.current?.setLayers(layers), [layers]);
  const pointSize = useViewer((s) => s.pointSize);
  useEffect(() => viewer.current?.setPointSize(pointSize), [pointSize]);

  // Render only while visible (the viewer stays mounted behind other views).
  const visible = useApp((s) => s.tab === 'viewer');
  useEffect(() => viewer.current?.setActive(visible), [visible]);

  useEditViewer(viewer, host);

  // Point cloud.
  const pc = previews.pointcloud;
  useEffect(() => {
    if (!pc || !viewer.current) return;
    const url = bust(window.splatcraft.app.fileUrl(pc.path), pc.v);
    viewer.current
      .loadPointCloud(url)
      .then(() => {
        set({ hasContent: true });
        // Frustum scale depends on the scene bounds → re-apply cameras.
        const cams = usePipeline.getState().previews.cameras;
        if (cams) viewer.current?.setCameras(cams.cameras);
      })
      .catch((e) => pushMessage({ level: 'warning', title: 'Point cloud could not be loaded', detail: String((e as Error)?.message ?? e) }));
  }, [pc?.v]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cameras.
  const cams = previews.cameras;
  useEffect(() => {
    if (!cams || !viewer.current) return;
    viewer.current.setCameras(cams.cameras);
    set({ hasContent: true });
  }, [cams?.v]); // eslint-disable-line react-hooks/exhaustive-deps

  // Splat hot-swap.
  const sp = previews.splat;
  useEffect(() => {
    if (!sp || !viewer.current) return;
    const url = bust(window.splatcraft.app.fileUrl(sp.path), sp.step ?? sp.v);
    set({ loading: true });
    viewer.current
      .loadSplat({ url, path: sp.path })
      .then(() => set({ hasContent: true, shownStep: sp.step, error: undefined }))
      .catch((e) => {
        set({ error: String(e) });
        pushMessage({ level: 'warning', title: 'Splat preview could not be loaded', detail: String((e as Error)?.message ?? e) });
      })
      .finally(() => {
        if (usePipeline.getState().previews.splat?.v === sp.v) set({ loading: false });
      });
  }, [sp?.v]); // eslint-disable-line react-hooks/exhaustive-deps

  // Expose camera commands to the canvas toolbar.
  useEffect(() => {
    set({
      commands: {
        resetView: () => viewer.current?.resetCamera(),
        screenshot: () => {
          const url = viewer.current?.screenshot();
          if (!url) return;
          const a = document.createElement('a');
          a.href = url;
          a.download = `splatcraft-${Date.now()}.png`;
          a.click();
        },
      },
    });
    return () => set({ commands: undefined });
  }, [set]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-viewport">
      <div ref={host} className="absolute inset-0" />

      {/* Top-left: live state (fixed slot) */}
      <div className="pointer-events-none absolute left-3 top-3 flex h-6 items-center gap-1.5">
        {shownStep !== undefined && layers.splat && (
          <Badge tone={running ? 'accent' : 'neutral'} icon={running ? Sparkles : Cuboid} className="tnum h-6 min-w-[124px] px-2 text-xs">
            {running ? 'Live' : 'Splat'} · step {shownStep.toLocaleString()}
          </Badge>
        )}
        <span className="flex size-6 items-center justify-center text-fg-muted">{loading && <Spinner size={13} />}</span>
      </div>

      <EditOverlay />

      {/* First splat of a session: blur + loader. Later hot-swaps only use the small spinner. */}
      <LoadingOverlay show={loading && shownStep === undefined && layers.splat} label="Loading splat" />

      {/* Empty / failure states */}
      {(failed || !hasContent) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto">
            {failed ? (
              <EmptyState icon={MonitorX} title="3D Unavailable" size="lg" />
            ) : !hasSources ? (
              <EmptyState icon={Upload} title="Drop Photos or Videos to Begin" size="lg" />
            ) : running ? (
              <EmptyState icon={Cuboid} title="Waiting for Preview" size="lg" />
            ) : (
              <EmptyState
                icon={Cuboid}
                title="Ready"
                size="lg"
                action={
                  <Button variant="primary" icon={Play} onClick={() => void run(undefined, 'all')}>
                    Run all
                  </Button>
                }
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
