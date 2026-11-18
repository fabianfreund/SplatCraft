import { LENGTH_UNITS, type LengthUnit } from '@splatcraft/core/alignment';
import { ArrowUpDown, Check, LandPlot, Ruler, Undo2, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TOOL_POINTS, useEdit } from '../../../store/edit';
import { useApp } from '../../../store/app';
import { usePipeline } from '../../../store/pipeline';
import { Button, cn, IconButton, Kbd, NumberField, SegmentedControl, Text } from '../../../ui';
import { formatLength, realLength } from './markers';
import { useAlignment, useEditStepSelected } from './useEditViewer';

/** Edit-step HUD on the 3D view: alignment state, tool progress and the scale prompt. */
export function EditOverlay() {
  const editing = useEditStepSelected();
  const visible = useApp((s) => s.tab === 'viewer');
  const pending = useEdit((s) => !!s.pendingScale);
  if (!editing || !visible) return null;
  return (
    <>
      <div data-edit-ui className="absolute right-3 top-3 z-10 flex flex-col items-end gap-1.5">
        <AlignmentChips />
        <ToolStatus />
      </div>
      {pending && <ScalePrompt />}
    </>
  );
}

function Chip({ icon: Icon, active, children }: { icon: LucideIcon; active: boolean; children: ReactNode }) {
  return (
    <div className={cn('glass flex h-8 items-center gap-1 rounded-lg border pl-2.5 pr-1', !active && 'text-fg-subtle')}>
      <Icon size={14} className={active ? 'text-fg' : 'text-fg-faint'} />
      {children}
    </div>
  );
}

function AlignmentChips() {
  const al = useAlignment();
  const running = usePipeline((s) => s.running);
  const { setGround, setScale } = useEdit.getState();
  const ground = al?.ground;
  const scale = al?.scale;
  return (
    <div className="flex items-center gap-1.5">
      <Chip icon={LandPlot} active={!!ground}>
        <Text size="xs" weight="medium" className="w-12">
          Ground
        </Text>
        <IconButton icon={ArrowUpDown} label="Flip up direction" size="sm" disabled={!ground || running} onClick={() => ground && setGround({ ...ground, flip: !ground.flip })} />
        <IconButton icon={X} label="Clear ground" size="sm" disabled={!ground || running} onClick={() => setGround(undefined)} />
      </Chip>
      <Chip icon={Ruler} active={!!scale}>
        <Text size="xs" weight="medium" num className="w-16 text-right">
          {scale ? formatLength(scale.distance, scale.unit) : '—'}
        </Text>
        <IconButton icon={X} label="Clear scale" size="sm" disabled={!scale || running} onClick={() => setScale(undefined)} />
      </Chip>
    </div>
  );
}

function ToolStatus() {
  const tool = useEdit((s) => s.tool);
  const count = useEdit((s) => s.draft.length);
  // Reserved slot: the row keeps its height when no tool is active.
  return (
    <div className="flex h-8 items-center">
      {tool && (
        <div className="glass flex h-8 items-center gap-2 rounded-lg border pl-2.5 pr-1" style={{ animation: 'sc-fade-in var(--sc-duration-fast) var(--sc-ease-out)' }}>
          <Text size="xs" weight="medium">
            {tool === 'ground' ? 'Ground' : 'Measure'}
          </Text>
          <Text size="xs" tone="subtle" num>
            {Math.min(count + 1, TOOL_POINTS[tool])}/{TOOL_POINTS[tool]}
          </Text>
          <Kbd>Esc</Kbd>
          <IconButton icon={Undo2} label="Undo point" size="sm" disabled={!count} onClick={() => useEdit.getState().undoPoint()} />
        </div>
      )}
    </div>
  );
}

/** Asks for the real length of the two picked points. Prefilled when the scene already has a scale. */
function ScalePrompt() {
  const pending = useEdit((s) => s.pendingScale)!;
  const lastUnit = useEdit((s) => s.unit);
  const al = useAlignment();
  const [unit, setUnit] = useState<LengthUnit>(lastUnit);
  const known = realLength(pending.a, pending.b, al, unit);
  const [value, setValue] = useState<number | undefined>(known !== undefined ? +known.toFixed(3) : undefined);
  const latest = useRef({ value, unit });
  latest.current = { value, unit };
  const box = useRef<HTMLFormElement>(null);
  useEffect(() => box.current?.querySelector('input')?.focus(), []);

  const confirm = () => {
    const { value: v, unit: u } = latest.current;
    if (v && v > 0) useEdit.getState().confirmScale(v, u);
  };

  return (
    <div data-edit-ui className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center px-6">
      <form
        ref={box}
        className="glass pointer-events-auto flex h-12 items-center gap-2 rounded-xl border p-1.5 pl-3"
        style={{ animation: 'sc-pop-spring var(--sc-duration-spring) var(--sc-ease-spring)' }}
        onSubmit={(e) => {
          e.preventDefault();
          // NumberField commits on blur: let it settle first.
          (document.activeElement as HTMLElement | null)?.blur();
          setTimeout(confirm, 0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            useEdit.getState().undoPoint();
          }
        }}
      >
        <Ruler size={15} className="text-fg-muted" />
        <NumberField value={value} onChange={setValue} min={0} step={unit === 'mm' ? 1 : 0.1} width={88} placeholder="0" />
        <SegmentedControl<LengthUnit> size="sm" ariaLabel="Unit" value={unit} segmentWidth={36} options={LENGTH_UNITS.map((u) => ({ value: u, label: u }))} onChange={setUnit} />
        <Button type="submit" size="sm" variant="primary" icon={Check} disabled={!value || value <= 0}>
          Set scale
        </Button>
        <IconButton icon={X} label="Cancel" size="sm" onClick={() => useEdit.getState().cancel()} />
      </form>
    </div>
  );
}
