import type { PresetId } from '@shared/api';
import { FolderPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PRESETS } from '../../lib/presets';
import { useApp } from '../../store/app';
import { Button, ChoiceCard, Field, Input, Select, Sheet, TagInput, Text, Textarea } from '../../ui';

export function NewProjectSheet() {
  const open = useApp((s) => s.newProjectOpen);
  const setOpen = useApp((s) => s.setNewProjectOpen);
  const create = useApp((s) => s.createProject);
  const busy = useApp((s) => s.busy);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [preset, setPreset] = useState<PresetId>('balanced');
  const [templates, setTemplates] = useState<{ id: string; title: string; description: string }[]>([]);
  const [template, setTemplate] = useState<string | undefined>();
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setTags([]);
    setPreset('balanced');
    window.splatcraft.pipeline
      .templates()
      .then((t) => {
        setTemplates(t);
        setTemplate(t[0]?.id);
      })
      .catch(() => setTemplates([]));
    setTimeout(() => nameRef.current?.focus(), 50);
  }, [open]);

  const submit = () => {
    if (!name.trim()) return nameRef.current?.focus();
    void create({ name: name.trim(), description: description.trim() || undefined, tags, template }, preset);
  };

  return (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      title="New Project"
      width={560}
      footer={
        <>
          <Text size="xs" tone="subtle" className="mr-auto flex items-center gap-1.5">
            <FolderPlus size={13} /> Location chosen next
          </Text>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!name.trim()} minWidth={96}>
            Create…
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Name" stacked>
          <Input ref={nameRef} size="lg" value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled Scan" />
        </Field>
        <Field label="Description" stacked>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Tags" stacked>
          <TagInput value={tags} onChange={setTags} placeholder="object, outdoor…" />
        </Field>
        {templates.length > 1 && (
          <Field label="Workflow" help={templates.find((t) => t.id === template)?.description} stacked>
            <Select size="md" className="w-full" value={template} options={templates.map((t) => ({ value: t.id, label: t.title }))} onChange={setTemplate} />
          </Field>
        )}
        <Field label="Preset" stacked>
          <div role="radiogroup" className="flex w-full gap-2">
            {PRESETS.map((p) => (
              <ChoiceCard key={p.id} icon={p.icon} title={p.title} meta={p.meta} help={p.help} selected={preset === p.id} onSelect={() => setPreset(p.id)} />
            ))}
          </div>
        </Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
