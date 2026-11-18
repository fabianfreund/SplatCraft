import type { RecentProject } from '@shared/api';
import { Box, FolderOpen, FolderSearch, History, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { abbreviatePath, formatRelative } from '../../lib/format';
import { useApp } from '../../store/app';
import { ContextMenu, EmptyState, ListRow, Skeleton, Thumb, type ContextMenuState } from '../../ui';

export function RecentList() {
  const recent = useApp((s) => s.recent);
  const open = useApp((s) => s.openProject);
  const remove = useApp((s) => s.removeRecent);
  const [sel, setSel] = useState(0);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (recent && sel >= recent.length) setSel(Math.max(0, recent.length - 1));
  }, [recent, sel]);
  useEffect(() => listRef.current?.focus(), [recent === null]);

  const openRow = (r: RecentProject | undefined) => r && r.exists && void open(r.dir);

  const onKey = (e: KeyboardEvent) => {
    if (!recent?.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = Math.max(0, Math.min(recent.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
      setSel(n);
      rows.current[n]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') openRow(recent[sel]);
    else if ((e.key === 'Backspace' || e.key === 'Delete') && e.metaKey) void remove(recent[sel].dir);
  };

  if (recent === null) {
    return (
      <div className="flex flex-col gap-1 px-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex h-[52px] items-center gap-2.5 px-2">
            <Skeleton width={36} height={36} className="rounded-md" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton width="55%" height={11} />
              <Skeleton width="80%" height={9} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (!recent.length) return <EmptyState icon={History} title="No Recent Projects" className="h-full pb-10" />;

  return (
    <>
      <div ref={listRef} tabIndex={0} role="listbox" aria-label="Recent projects" onKeyDown={onKey} className="no-drag scroll-stable flex min-h-0 flex-1 flex-col gap-0.5 px-3 pb-3 outline-none">
        {recent.map((r, i) => (
          <ListRow
            key={r.dir}
            ref={(el) => {
              rows.current[i] = el;
            }}
            size="lg"
            selected={i === sel}
            dimmed={!r.exists}
            leading={<Thumb src={r.thumbnail ? window.splatcraft.app.fileUrl(r.thumbnail) : undefined} icon={Box} size={36} selected={i === sel} />}
            title={r.name}
            subtitle={r.exists ? abbreviatePath(r.dir) : `Missing · ${abbreviatePath(r.dir)}`}
            trailing={<span className={i === sel ? 'tnum text-2xs text-accent-ink opacity-70' : 'tnum text-2xs text-fg-faint'}>{formatRelative(r.openedAt)}</span>}
            onClick={() => setSel(i)}
            onDoubleClick={() => openRow(r)}
            onContextMenu={(e) => {
              e.preventDefault();
              setSel(i);
              setMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  { label: 'Open', icon: FolderOpen, onSelect: () => openRow(r), disabled: !r.exists },
                  { label: 'Show in Folder', icon: FolderSearch, onSelect: () => void window.splatcraft.app.revealInFolder(r.dir), disabled: !r.exists },
                  { label: 'Remove from Recents', icon: Trash2, danger: true, onSelect: () => void remove(r.dir) },
                ],
              });
            }}
          />
        ))}
      </div>
      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </>
  );
}
