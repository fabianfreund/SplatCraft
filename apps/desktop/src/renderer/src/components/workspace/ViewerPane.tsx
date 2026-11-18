import { Aperture, Camera, Cuboid, Focus, ImageDown, MonitorX, Play, Sparkles, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../store/app';
import { pushMessage } from '../../store/messages';
import { usePipeline } from '../../store/pipeline';
import { useViewer } from '../../store/viewer';
import { Badge, Button, Divider, EmptyState, IconButton, Spinner } from '../../ui';
import { SparkViewer } from '../../viewer/SparkViewer';
import type { ViewerAPI } from '../../viewer/ViewerAPI';

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
  const { layers, setLayer, loading, shownStep, hasContent, set } = useViewer();

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

  const screenshot = () => {
    const url = viewer.current?.screenshot();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `splatcraft-${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="absolute inset-0 overflow-hidden bg-viewport">
      <div ref={host} className="absolute inset-0" />

      {/* Top-left: live state (fixed slot) */}
      <div className="pointer-events-none absolute left-3 top-3 flex h-6 items-center gap-1.5">
        {shownStep !== undefined && (
          <Badge tone={running ? 'accent' : 'neutral'} icon={running ? Sparkles : Cuboid} className="tnum h-6 min-w-[124px] px-2 text-xs">
            {running ? 'Live' : 'Splat'} · step {shownStep.toLocaleString()}
          </Badge>
        )}
        <span className="flex size-6 items-center justify-center text-fg-muted">{loading && <Spinner size={13} />}</span>
      </div>

      {/* Top-right: toolbar */}
      {!failed && (
        <div className="absolute right-3 top-3 flex h-8 items-center gap-0.5 rounded-md border border-line-strong bg-surface-2 px-1 shadow-md">
          <IconButton icon={Aperture} label="Points" active={layers.points} onClick={() => setLayer('points', !layers.points)} tooltipSide="bottom" />
          <IconButton icon={Camera} label="Cameras" active={layers.cameras} onClick={() => setLayer('cameras', !layers.cameras)} tooltipSide="bottom" />
          <IconButton icon={Sparkles} label="Splat" active={layers.splat} onClick={() => setLayer('splat', !layers.splat)} tooltipSide="bottom" />
          <Divider vertical className="mx-0.5" />
          <IconButton icon={Focus} label="Reset View" onClick={() => viewer.current?.resetCamera()} tooltipSide="bottom" />
          <IconButton icon={ImageDown} label="Screenshot" onClick={screenshot} tooltipSide="bottom" />
        </div>
      )}

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
