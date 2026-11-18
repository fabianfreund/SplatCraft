import type { ProjectMeta } from '@shared/api';
import { useEffect, useState } from 'react';
import { useApp } from '../../store/app';
import { Field, Input, TagInput, Textarea } from '../../ui';

/** Project description, tags and capture info. Saves on blur. */
export function MetaEditor({ meta }: { meta: ProjectMeta }) {
  const updateMeta = useApp((s) => s.updateMeta);
  const [description, setDescription] = useState(meta.description);
  const [capture, setCapture] = useState(meta.capture);
  useEffect(() => {
    setDescription(meta.description);
    setCapture(meta.capture);
  }, [meta.id, meta.description, meta.capture]);

  const saveCapture = (patch: Partial<ProjectMeta['capture']>) => {
    const next = { ...capture, ...patch };
    if (JSON.stringify(next) !== JSON.stringify(meta.capture)) void updateMeta({ capture: next });
  };
  const capField = (key: keyof ProjectMeta['capture'], label: string, type = 'text') => (
    <Field label={label}>
      <Input
        size="sm"
        type={type}
        value={capture[key] ?? ''}
        onChange={(e) => setCapture({ ...capture, [key]: e.target.value })}
        onBlur={(e) => saveCapture({ [key]: e.target.value || undefined })}
      />
    </Field>
  );

  return (
    <div className="flex flex-col gap-1.5 px-3 pb-3">
      <Field label="Description" stacked>
        <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => description !== meta.description && void updateMeta({ description })} />
      </Field>
      <Field label="Tags" stacked>
        <TagInput size="sm" value={meta.tags} onChange={(tags) => void updateMeta({ tags })} />
      </Field>
      {capField('date', 'Captured', 'date')}
      {capField('location', 'Location')}
      {capField('device', 'Device')}
      <Field label="Notes" stacked>
        <Textarea rows={2} value={capture.notes ?? ''} onChange={(e) => setCapture({ ...capture, notes: e.target.value })} onBlur={(e) => saveCapture({ notes: e.target.value || undefined })} />
      </Field>
    </div>
  );
}
