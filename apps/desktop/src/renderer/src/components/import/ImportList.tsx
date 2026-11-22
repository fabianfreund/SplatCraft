import { File, Film, Image as ImageIcon, Scissors, X } from 'lucide-react';
import { useState } from 'react';
import { formatBytes, formatSeconds } from '../../lib/format';
import { IconButton, ListRow, Thumb } from '../../ui';
import { trimmedLength } from './settings';
import type { ImportItem } from './useImport';

const kindIcon = { image: ImageIcon, video: Film, other: File } as const;
const THUMB = 36;

/** Pending files: thumbnail, name, size or (trimmed) length. */
export function ImportList({
  items,
  selected,
  removable,
  onSelect,
  onRemove,
  onPatch,
}: {
  items: ImportItem[];
  selected?: string;
  removable: boolean;
  onSelect: (path: string) => void;
  onRemove: (path: string) => void;
  onPatch: (path: string, p: Partial<ImportItem>) => void;
}) {
  return (
    <div role="listbox" aria-label="Files" className="flex flex-col gap-0.5 p-1.5">
      {items.map((i) => {
        const len = i.kind === 'video' ? trimmedLength(i.duration, i.trim) : undefined;
        return (
          <ListRow
            key={i.path}
            size="lg"
            selected={i.path === selected}
            dimmed={i.kind === 'other'}
            onClick={() => onSelect(i.path)}
            leading={
              i.kind === 'video' ? (
                <VideoThumb item={i} onMeta={(p) => onPatch(i.path, p)} />
              ) : (
                <Thumb size={THUMB} icon={kindIcon[i.kind] ?? File} src={i.kind === 'image' ? window.splatcraft.app.fileUrl(i.path) : undefined} />
              )
            }
            title={i.name}
            subtitle={
              <span className="tnum flex items-center gap-1.5">
                {formatBytes(i.size)}
                {i.kind === 'video' && (
                  <>
                    <span className="text-fg-faint">·</span>
                    <span className={i.trim ? 'text-accent' : undefined}>{formatSeconds(len)}</span>
                    {i.trim && <Scissors size={11} className="text-accent" aria-label="Trimmed" />}
                  </>
                )}
              </span>
            }
            trailing={
              <IconButton
                icon={X}
                size="xs"
                label="Don’t import"
                className={removable ? 'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100' : 'invisible'}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(i.path);
                }}
              />
            }
          />
        );
      })}
    </div>
  );
}

/** First frame of a video in a Thumb-sized box; reports duration / unplayable once. */
function VideoThumb({ item, onMeta }: { item: ImportItem; onMeta: (p: Partial<ImportItem>) => void }) {
  const [ready, setReady] = useState(false);
  if (item.unplayable) return <Thumb size={THUMB} icon={Film} />;
  return (
    <span className="relative flex shrink-0 overflow-hidden rounded-md border border-line-strong bg-surface-3" style={{ width: THUMB, height: THUMB }}>
      {!ready && (
        <span className="absolute inset-0 flex items-center justify-center text-accent">
          <Film size={Math.round(THUMB * 0.48)} strokeWidth={1.75} />
        </span>
      )}
      <video
        src={`${window.splatcraft.app.fileUrl(item.path)}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        className="size-full object-cover"
        onLoadedData={() => setReady(true)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0 && item.duration === undefined) onMeta({ duration: d });
        }}
        onError={() => onMeta({ unplayable: true })}
      />
    </span>
  );
}
