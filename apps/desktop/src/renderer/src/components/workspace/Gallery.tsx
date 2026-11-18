import type { ProjectMeta } from '@shared/api';
import { Film, FolderPlus, Image as ImageIcon, Play, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatBytes } from '../../lib/format';
import { useApp } from '../../store/app';
import { qualityStepKey, stepStatus, usePipeline } from '../../store/pipeline';
import { Badge, Button, ChipGroup, EmptyState, ImageTile, Spinner } from '../../ui';
import { SourcesButton } from './SourcesButton';
import { addSources } from './useDrop';
import { useFrames } from './useFrames';

type Filter = 'all' | 'kept' | 'rejected';

const GRID = 'grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(176px,1fr))]';

export function Gallery() {
  const project = useApp((s) => s.project)!;
  const frames = useFrames();
  const [filter, setFilter] = useState<Filter>('all');
  const sources = project.meta.sources;
  const hasFrames = frames.items.length > 0;
  const scored = frames.canToggle;

  const shown = useMemo(
    () => (filter === 'all' ? frames.items : frames.items.filter((f) => (filter === 'kept' ? f.kept : !f.kept))),
    [frames.items, filter],
  );

  return (
    <div className="absolute inset-0 flex flex-col bg-bg">
      {/* Header: fixed height, all slots reserved */}
      <div className="flex h-12 shrink-0 items-center gap-3 px-5">
        <SourcesButton />
        <div className="ml-auto flex items-center">
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
      <ReviewBar kept={frames.kept} rejected={frames.rejected} visible={scored} />
      <div className="scroll-stable min-h-0 flex-1 px-5 pb-5">
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
            {shown.map((f) => (
              <ImageTile
                key={f.path}
                src={window.splatcraft.app.fileUrl(f.path)}
                dimmed={!f.kept}
                score={f.score}
                marked={f.overridden}
                badge={!f.kept && f.reason ? <Badge tone={f.reason === 'excluded' ? 'neutral' : 'danger'}>{f.reason}</Badge> : undefined}
                tooltip={
                  <span className="tnum">
                    {f.name}
                    {f.score !== undefined && ` · ${Math.round(f.score * 100)}`}
                  </span>
                }
                onClick={frames.canToggle ? () => frames.toggle(f) : undefined}
              />
            ))}
          </div>
        ) : (
          <SourceGrid dir={project.dir} sources={sources} />
        )}
      </div>
    </div>
  );
}

/** Reserved-height strip shown while reviewing frames: counts + Run all. */
function ReviewBar({ kept, rejected, visible }: { kept: number; rejected: number; visible: boolean }) {
  const spec = usePipeline((s) => s.spec);
  const steps = usePipeline((s) => s.steps);
  const plan = usePipeline((s) => s.plan);
  const running = usePipeline((s) => s.running);
  const run = usePipeline((s) => s.run);
  const qKey = qualityStepKey(spec);
  const idx = spec?.steps.findIndex((x) => x.key === qKey) ?? -1;
  const next = idx >= 0 ? spec?.steps.slice(idx + 1).find((x) => x.enabled) : undefined;
  const nextDone = next ? ['done', 'cached'].includes(stepStatus({ steps, plan }, next.key, true).status) : true;
  const qRunning = qKey ? steps[qKey]?.status === 'running' : false;
  const show = visible && !nextDone;
  return (
    <div className="flex h-11 shrink-0 items-center px-5">
      {show && (
        <div
          className="flex h-9 w-full items-center gap-3 rounded-lg bg-surface-2 pl-3.5 pr-1.5"
          style={{ animation: 'sc-fade-in var(--sc-duration-base) var(--sc-ease-out)' }}
        >
          <span className="flex w-4 items-center justify-center">{qRunning && <Spinner size={12} />}</span>
          <span className="tnum text-sm text-fg">
            <span className="inline-block min-w-[24px] text-right font-semibold">{kept}</span> <span className="text-fg-muted">kept</span>
            <span className="mx-2 text-fg-faint">·</span>
            <span className="inline-block min-w-[16px] text-right font-semibold text-danger">{rejected}</span> <span className="text-fg-muted">rejected</span>
          </span>
          <Button size="sm" variant="primary" icon={Play} className="ml-auto" minWidth={88} disabled={running} onClick={() => void run(undefined, 'all')}>
            Run all
          </Button>
        </div>
      )}
    </div>
  );
}

function SourceGrid({ dir, sources }: { dir: string; sources: ProjectMeta['sources'] }) {
  const abs = (p: string) => (/^([/\\]|[A-Za-z]:)/.test(p) ? p : `${dir}/${p}`);
  return (
    <div className={GRID}>
      {sources.map((s) => (
        <ImageTile
          key={s.id}
          src={s.kind === 'image' ? window.splatcraft.app.fileUrl(abs(s.path)) : undefined}
          placeholder={s.kind === 'video' ? <Film size={28} strokeWidth={1.5} /> : <ImageIcon size={28} strokeWidth={1.5} />}
          badge={s.kind === 'video' ? <Badge icon={Play}>video</Badge> : undefined}
          corner={<Badge className="tnum">{formatBytes(s.size)}</Badge>}
          tooltip={s.name}
        />
      ))}
    </div>
  );
}
