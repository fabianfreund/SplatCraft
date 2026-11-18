import { alignmentTransform, isIdentity, similarityMatrix, type SceneAlignment, type Vec3 } from '@splatcraft/core/alignment';
import { useEffect, useRef, type RefObject } from 'react';
import { useApp } from '../../../store/app';
import { ALIGNMENT_PARAM, alignmentStepKey, useEdit } from '../../../store/edit';
import { effectiveSelectedKey, usePipeline } from '../../../store/pipeline';
import { useViewer } from '../../../store/viewer';
import type { ViewerAPI } from '../../../viewer/ViewerAPI';
import { buildMarkers } from './markers';

/** A click moves less than this (px); more is an orbit drag. */
const CLICK_SLOP = 4;

/** The scene alignment of the current workflow (undefined when unset or unsupported). */
export function useAlignment() {
  return usePipeline((s) => {
    const key = alignmentStepKey(s.spec, s.stages);
    return key ? (s.spec?.steps.find((st) => st.key === key)?.params[ALIGNMENT_PARAM] as SceneAlignment | undefined) : undefined;
  });
}

/** True while the step that owns the alignment is selected (the Edit step). */
export function useEditStepSelected() {
  return usePipeline((s) => {
    const key = alignmentStepKey(s.spec, s.stages);
    return !!key && effectiveSelectedKey(s) === key;
  });
}

/**
 * Connects the edit tools to the viewer: applies the alignment to the scene,
 * draws markers, and turns clicks into picked points while a tool is active.
 */
export function useEditViewer(viewer: RefObject<ViewerAPI | null>, surface: RefObject<HTMLElement | null>) {
  const alignment = useAlignment();
  const editing = useEditStepSelected();
  const visible = useApp((s) => s.tab === 'viewer');
  const tool = useEdit((s) => s.tool);
  const draft = useEdit((s) => s.draft);
  const overlays = useEdit((s) => s.overlays);

  useEffect(() => {
    const t = alignmentTransform(alignment);
    viewer.current?.setAlignment(isIdentity(t) ? null : similarityMatrix(t));
  }, [alignment, viewer]);

  // Markers and splat highlight. The cursor point changes every frame, so it
  // lives in a ref and redraws the viewer directly instead of re-rendering React.
  const hover = useRef<Vec3 | null>(null);
  const redraw = useRef(() => {});
  redraw.current = () => {
    const v = viewer.current;
    if (!v) return;
    const h = tool ? hover.current : null;
    v.setMarkers(buildMarkers(alignment, editing, tool, draft, h, overlays));
    const plane = tool === 'ground' && draft.length === 2 && h ? ([draft[0], draft[1], h] as [Vec3, Vec3, Vec3]) : null;
    v.setHighlight({ hover: h, plane, tone: tool ?? 'ground' });
  };
  useEffect(() => {
    if (!tool) hover.current = null;
    redraw.current();
  }, [alignment, editing, tool, draft, overlays, viewer]);

  // G / M toggle the tools on the Edit step.
  const pickable = useViewer((s) => s.hasContent);
  const running = usePipeline((s) => s.running);
  useEffect(() => {
    if (!editing || !visible || !pickable || running) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)))) return;
      const k = e.key.toLowerCase();
      const next = k === 'g' ? 'ground' : k === 'm' ? 'measure' : null;
      if (!next) return;
      e.preventDefault();
      const edit = useEdit.getState();
      edit.setTool(edit.tool === next ? null : next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, visible, pickable, running]);

  // Leaving the step or the 3D view (or a run starting) ends the tool.
  useEffect(() => {
    if (running) useEdit.getState().cancel();
  }, [running]);
  useEffect(() => {
    if (!editing || !visible) useEdit.getState().cancel();
  }, [editing, visible]);

  useEffect(() => {
    const el = surface.current;
    if (!el || !tool) return;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    };
    // Hover: one pick per frame at most, never while dragging (orbit).
    let frame = 0;
    let at: { x: number; y: number } | null = null;
    const onMove = (e: PointerEvent) => {
      if (e.buttons) {
        if (hover.current) {
          hover.current = null;
          redraw.current();
        }
        return;
      }
      at = { x: e.clientX, y: e.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!at || useEdit.getState().pendingScale) return;
        hover.current = viewer.current?.pick(at.x, at.y)?.point ?? null;
        redraw.current();
      });
    };
    const onLeave = () => {
      at = null;
      hover.current = null;
      redraw.current();
    };
    const onUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      if (!start || e.button !== 0 || Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_SLOP) return;
      if ((e.target as HTMLElement).closest('[data-edit-ui]')) return;
      const edit = useEdit.getState();
      if (edit.pendingScale) return;
      const p = viewer.current?.pick(e.clientX, e.clientY);
      if (p) edit.addPoint(p);
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.key === 'Escape') useEdit.getState().cancel();
      else if (e.key === 'Backspace' || ((e.metaKey || e.ctrlKey) && e.key === 'z')) {
        e.preventDefault();
        useEdit.getState().undoPoint();
      } else return;
      e.stopPropagation();
    };
    const prevCursor = el.style.cursor;
    el.style.cursor = 'crosshair';
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      el.style.cursor = prevCursor;
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [tool, surface, viewer]);
}
