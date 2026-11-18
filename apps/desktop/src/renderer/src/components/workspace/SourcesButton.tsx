import { ChevronDown, File, Film, FolderPlus, Image as ImageIcon, Scissors, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatBytes } from '../../lib/format';
import { useImport } from '../import/useImport';
import { useApp } from '../../store/app';
import { Button, cn, IconButton, Label, ListRow, Popover, Text } from '../../ui';
import { addSources } from './useDrop';

const kindIcon = { image: ImageIcon, video: Film, other: File } as const;

/** "8 sources ▾" → popover listing the imported files. */
export function SourcesButton() {
  const sources = useApp((s) => s.project!.meta.sources);
  const setMeta = useApp((s) => s.setMeta);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const videos = sources.filter((s) => s.kind === 'video').length;
  const photos = sources.filter((s) => s.kind === 'image').length;
  return (
    <>
      <Button ref={anchor} size="sm" variant="ghost" trailing={<ChevronDown size={12} />} onClick={() => setOpen(!open)} minWidth={120} className="justify-start" tooltip="Sources">
        <span className="tnum flex items-center gap-1.5">
          <ImageIcon size={13} className="text-fg-subtle" />
          <span className="min-w-[20px]">{photos}</span>
          <Film size={13} className="text-fg-subtle" />
          <span className="min-w-[20px]">{videos}</span>
        </span>
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={340}>
        <div className="flex h-10 items-center px-3">
          <Label>Sources</Label>
          <span className="tnum ml-1.5 text-2xs text-fg-faint">{sources.length}</span>
          <div className="ml-auto">
            <Button
              size="sm"
              variant="subtle"
              icon={FolderPlus}
              onClick={() => {
                setOpen(false);
                void addSources();
              }}
            >
              Add…
            </Button>
          </div>
        </div>
        <div className="flex flex-col px-1.5 pb-1.5">
          {sources.map((s) => {
            const Icon = kindIcon[s.kind] ?? File;
            return (
              <ListRow
                key={s.id}
                size="sm"
                leading={<Icon size={14} className={s.trim ? 'text-accent' : 'text-fg-subtle'} />}
                title={s.name}
                trailing={
                  <>
                    <Text size="2xs" tone="subtle" num>
                      {formatBytes(s.size)}
                    </Text>
                    <span className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <IconButton
                        icon={Scissors}
                        label="Trim video"
                        size="xs"
                        className={cn(s.kind !== 'video' && 'invisible')}
                        onClick={() => {
                          setOpen(false);
                          useImport.getState().edit(s.id);
                        }}
                      />
                      <IconButton icon={Trash2} label="Remove" size="xs" onClick={async () => setMeta(await window.splatcraft.sources.remove([s.id]))} />
                    </span>
                  </>
                }
              />
            );
          })}
        </div>
      </Popover>
    </>
  );
}
