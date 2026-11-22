import type { ProjectMeta } from '@shared/api';
import { Film, FolderPlus, Image as ImageIcon, Play, Upload } from 'lucide-react';
import { useMemo, useState, type MouseEvent } from 'react';
import { formatBytes } from '../../lib/format';
import { useApp } from '../../store/app';
import { reviewStepKey, stepStatus, usePipeline } from '../../store/pipeline';
import { Badge, Button, ChipGroup, EmptyState, ImageTile, SegmentedControl, Spinner } from '../../ui';
import { MediaLightbox, type LightboxItem } from './MediaLightbox';
import { SourcesButton } from './SourcesButton';
import { addSources } from './useDrop';
import { useFrames, type FrameItem } from './useFrames';

type Filter = 'all' | 'kept' | 'rejected';

const GRID = 'grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(176px,1fr))]';

/** Lightbox over a snapshot of the grid order, so toggling (which may filter a tile out) never breaks navigation. */
const absPath = (dir: string, p: string) => (/^([/\\]|[A-Za-z]:)/.test(p) ? p : `${dir}/${p}`);

type Open = { content: 'sources' | 'frames'; keys: string[]; index: number };

const frameItem = (f: FrameItem): LightboxItem => ({
  key: f.path,
  name: f.name,
  src: window.splatcraft.app.fileUrl(f.path),
  score: f.score,
  reason: f.kept ? undefined : f.reason,
  dimmed: !f.kept,
});

function TileTip({ name, score, hint }: { name: string; score?: number; hint: string }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="tnum">
        {name}
        {score !== undefined && ` · ${Math.round(score * 100)}`}
      </span>
      <span className="text-fg-subtle">{hint}</span>
    </span>
  );
}

export function Gallery() {
  const project = useApp((s) => s.project)!;
  const frames = useFrames();
  const [filter, setFilter] = useState<Filter>('all');
  const sources = project.meta.sources;
  // Step focus decides the content: Media → input media, other steps → frames.
  const content = useApp((s) => s.gallery);
  const setContent = useApp((s) => s.setGallery);
  const canSwitch = frames.items.length > 0;
  const hasFrames = content === 'frames' && frames.items.length > 0;
  const scored = frames.canToggle;

  const shown = useMemo(
    () => (filter === 'all' ? frames.items : frames.items.filter((f) => (filter === 'kept' ? f.kept : !f.kept))),
    [frames.items, filter],
  );

  const [open, setOpen] = useState<Open | null>(null);
  const byPath = useMemo(() => new Map(frames.items.map((f) => [f.path, f])), [frames.items]);
  const abs = (p: string) => absPath(project.dir, p);
  const lightbox = useMemo<LightboxItem[]>(() => {
    if (!open) return [];
    if (open.content === 'frames') return open.keys.flatMap((k) => (byPath.has(k) ? [frameItem(byPath.get(k)!)] : []));
    const byId = new Map(sources.map((s) => [s.id, s]));
    return open.keys.flatMap((k) => {
      const s = byId.get(k);
      if (!s) return [];
      return [
        {
          key: s.id,
          name: s.name,
          src: s.kind === 'image' ? window.splatcraft.app.fileUrl(absPath(project.dir, s.path)) : undefined,
          placeholder: s.kind === 'video' ? <Film size={48} strokeWidth={1.25} /> : <ImageIcon size={48} strokeWidth={1.25} />,
        },
      ];
    });
  }, [open, byPath, sources, project.dir]);
  const showLightbox = !!open && open.content === (hasFrames ? 'frames' : 'sources') && lightbox.length > 0;
  const toggleFromLightbox = (it: LightboxItem) => {
    const f = byPath.get(it.key);
    if (f) frames.toggle(f);
  };
  const onFrameContext = (f: FrameItem) => (e: MouseEvent) => {
    e.preventDefault();
    if (frames.canToggle) frames.toggle(f);
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-bg" style={{ animation: 'sc-fade-in var(--sc-duration-base) var(--sc-ease-out)' }}>
      {/* Header: fixed height, all slots reserved */}
      <div className="flex h-12 shrink-0 items-center gap-3 px-5">
        <SourcesButton />
        <ReviewBar kept={frames.kept} rejected={frames.rejected} visible={scored && hasFrames} />
        <div className="ml-auto flex items-center gap-3">
          {canSwitch && (
            <SegmentedControl<'sources' | 'frames'>
              ariaLabel="Gallery content"
              size="sm"
              value={content}
              onChange={setContent}
              options={[
                { value: 'sources', label: 'Media' },
                { value: 'frames', label: 'Frames' },
              ]}
            />
          )}
          {hasFrames && (
            <ChipGroup<Filter>
              value={filter}
              onChange={setFilter}
              chips={[
                { value: 'all', label: 'All', count: frames.items.length },
                { value: 'kept', label: 'Kept', count: scored ? frames.kept : undefined, tone: 'success' },
                { value: 'rejected', label: 'Rejected', count: scored ? frames.rejected : undefined, tone: 'danger' },
              ]}
            />
          )}
        </div>
      </div>
      <div className="scroll-stable min-h-0 flex-1 px-5 pb-24">
        {!sources.length ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={Upload}
              title="Drop Photos or Videos"
              size="lg"
              action={
                <Button icon={FolderPlus} onClick={() => void addSources()}>
                  Add…
                </Button>
              }
            />
          </div>
        ) : hasFrames ? (
          <div className={GRID}>
            {shown.map((f, i) => (
              <div key={f.path} onContextMenu={onFrameContext(f)}>
                <ImageTile
                  src={window.splatcraft.app.fileUrl(f.path)}
                  dimmed={!f.kept}
                  score={f.score}
                  marked={f.overridden}
                  badge={!f.kept && f.reason ? <Badge tone={f.reason === 'excluded' ? 'neutral' : 'danger'}>{f.reason}</Badge> : undefined}
                  tooltip={
                    <TileTip
                      name={f.name}
                      score={f.score}
                      hint={frames.canToggle ? `Click to open · Right-click to ${f.kept ? 'exclude' : 'include'}` : 'Click to open'}
                    />
                  }
                  onClick={() => setOpen({ content: 'frames', keys: shown.map((x) => x.path), index: i })}
                />
              </div>
            ))}
          </div>
        ) : (
          <SourceGrid abs={abs} sources={sources} onOpen={(i) => setOpen({ content: 'sources', keys: sources.map((s) => s.id), index: i })} />
        )}
      </div>
      {showLightbox && (
        <MediaLightbox
          items={lightbox}
          index={Math.min(open.index, lightbox.length - 1)}
          onIndex={(index) => setOpen({ ...open, index })}
          onClose={() => setOpen(null)}
          onToggle={open.content === 'frames' && frames.canToggle ? toggleFromLightbox : undefined}
        />
      )}
    </div>
  );
}

/** Reserved-height strip shown while reviewing frames: counts + Run all. */
function ReviewBar({ kept, rejected, visible }: { kept: number; rejected: number; visible: boolean }) {
  const spec = usePipeline((s) => s.spec);
  const stages = usePipeline((s) => s.stages);
  const steps = usePipeline((s) => s.steps);
  const plan = usePipeline((s) => s.plan);
  const running = usePipeline((s) => s.running);
  const run = usePipeline((s) => s.run);
  const qKey = reviewStepKey(spec, stages);
  const idx = spec?.steps.findIndex((x) => x.key === qKey) ?? -1;
  const next = idx >= 0 ? spec?.steps.slice(idx + 1).find((x) => x.enabled) : undefined;
  const nextDone = next ? ['done', 'cached'].includes(stepStatus({ steps, plan }, next.key, true).status) : true;
  const qRunning = qKey ? steps[qKey]?.status === 'running' : false;
  const show = visible && !nextDone;
  return (
    <div className="flex h-8 min-w-0 items-center">
      {show && (
        <div
          className="flex h-8 items-center gap-3 rounded-md bg-surface-2 pl-3 pr-1"
          style={{ animation: 'sc-fade-in var(--sc-duration-base) var(--sc-ease-out)' }}
        >
          <span className="flex w-3 items-center justify-center">{qRunning && <Spinner size={12} />}</span>
          <span className="tnum whitespace-nowrap text-sm text-fg">
            <span className="inline-block min-w-[24px] text-right font-semibold">{kept}</span> <span className="text-fg-muted">kept</span>
            <span className="mx-2 text-fg-faint">·</span>
            <span className="inline-block min-w-[16px] text-right font-semibold text-danger">{rejected}</span> <span className="text-fg-muted">rejected</span>
          </span>
          <Button size="sm" variant="primary" icon={Play} minWidth={88} disabled={running} onClick={() => void run(undefined, 'all')}>
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}

function SourceGrid({ abs, sources, onOpen }: { abs: (p: string) => string; sources: ProjectMeta['sources']; onOpen: (index: number) => void }) {
  return (
    <div className={GRID}>
      {sources.map((s, i) => (
        <ImageTile
          key={s.id}
          src={s.kind === 'image' ? window.splatcraft.app.fileUrl(abs(s.path)) : undefined}
          placeholder={s.kind === 'video' ? <Film size={28} strokeWidth={1.5} /> : <ImageIcon size={28} strokeWidth={1.5} />}
          badge={s.kind === 'video' ? <Badge icon={Play}>video</Badge> : undefined}
          corner={<Badge className="tnum">{formatBytes(s.size)}</Badge>}
          tooltip={<TileTip name={s.name} hint="Click to open" />}
          onClick={() => onOpen(i)}
        />
      ))}
    </div>
  );
}
