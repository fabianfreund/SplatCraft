import { useEffect, useState } from 'react';
import { useApp } from '../../store/app';
import { usePipeline } from '../../store/pipeline';

/** Adds sources, then auto-runs up to the review (quality) step. */
export async function addSources(paths?: string[]) {
  try {
    const before = useApp.getState().project?.meta.sources.length ?? 0;
    const meta = await window.splatcraft.sources.add(paths);
    useApp.getState().setMeta(meta);
    await usePipeline.getState().refreshPlan();
    if (meta.sources.length > before) {
      useApp.getState().setTab('gallery', false);
      void usePipeline.getState().runReview();
    }
  } catch (e) {
    useApp.getState().setError(String((e as Error).message ?? e));
  }
}

/** Window-wide file drop → sources.add(paths). Returns whether a drag is over. */
export function useWindowDrop() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const overFn = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      const paths = files.map((f) => window.splatcraft.sources.pathForFile(f)).filter(Boolean);
      if (paths.length) void addSources(paths);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return over;
}
