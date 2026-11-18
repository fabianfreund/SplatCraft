import { ChevronDown, FolderSearch, FolderX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { abbreviatePath } from '../../lib/format';
import { useApp } from '../../store/app';
import { Button, Divider, Field, Input, Popover, Text } from '../../ui';
import { MetaEditor } from './MetaEditor';

/** Project name in the top bar → popover with name + metadata. */
export function ProjectMenu() {
  const project = useApp((s) => s.project)!;
  const updateMeta = useApp((s) => s.updateMeta);
  const close = useApp((s) => s.closeProject);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.meta.name);
  const anchor = useRef<HTMLButtonElement>(null);
  useEffect(() => setName(project.meta.name), [project.meta.name]);
  const commit = () => {
    const n = name.trim();
    if (n && n !== project.meta.name) void updateMeta({ name: n });
    else setName(project.meta.name);
  };
  return (
    <>
      <Button ref={anchor} variant="ghost" size="sm" trailing={<ChevronDown size={12} className="text-fg-subtle" />} onClick={() => setOpen(!open)} className="max-w-[240px]">
        <span className="ellipsis text-sm font-semibold text-fg">{project.meta.name}</span>
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={340}>
        <div className="flex flex-col gap-1.5 p-3 pb-2">
          <Field label="Name">
            <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          </Field>
          <Text size="2xs" tone="faint" truncate title={project.dir}>
            {abbreviatePath(project.dir)}
          </Text>
        </div>
        <MetaEditor meta={project.meta} />
        <Divider />
        <div className="flex gap-1 p-2">
          <Button size="sm" variant="ghost" icon={FolderSearch} onClick={() => void window.splatcraft.app.revealInFolder(project.dir)}>
            Show in Folder
          </Button>
          <Button size="sm" variant="ghost" icon={FolderX} className="ml-auto" onClick={() => void close()}>
            Close Project
          </Button>
        </div>
      </Popover>
    </>
  );
}
