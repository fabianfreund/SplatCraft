import type { PresetId, StageDescriptor } from '@shared/api';
import { RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { fieldsFromSchema, type FieldSpec } from '../../lib/schema';
import { Field, IconButton, Input, NumberField, Select, Slider, Switch, TagInput } from '../../ui';

export interface ParamFormProps {
  descriptor: StageDescriptor;
  preset: PresetId;
  /** User overrides only. */
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
}

/** Auto-generated form from a stage's JSON Schema. */
export function ParamForm({ descriptor, preset, params, onChange }: ParamFormProps) {
  const fields = useMemo(() => fieldsFromSchema(descriptor.paramsJsonSchema).filter((f) => f.kind !== 'unknown'), [descriptor]);
  if (!fields.length) return null;

  const set = (key: string, v: unknown) => {
    const next = { ...params };
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1">
      {fields.map((f) => {
        const base = descriptor.presets[preset]?.[f.key] ?? f.default;
        const changed = Object.prototype.hasOwnProperty.call(params, f.key);
        const value = changed ? params[f.key] : base;
        return (
          <Field
            key={f.key}
            label={f.title}
            help={f.description}
            stacked={f.kind === 'tags'}
            trailing={
              <IconButton
                icon={RotateCcw}
                size="xs"
                label="Reset to preset"
                className={changed ? '' : 'invisible'}
                onClick={() => set(f.key, undefined)}
              />
            }
          >
            <Control field={f} value={value} base={base} changed={changed} onChange={(v) => set(f.key, v)} />
          </Field>
        );
      })}
    </div>
  );
}

function Control({ field: f, value, base, changed, onChange }: { field: FieldSpec; value: unknown; base: unknown; changed: boolean; onChange: (v: unknown) => void }) {
  switch (f.kind) {
    case 'boolean':
      return <Switch size="sm" checked={!!value} onChange={onChange} label={f.title} />;
    case 'enum':
      return (
        <Select
          size="sm"
          className="flex-1"
          changed={changed}
          value={value === undefined ? undefined : String(value)}
          options={(f.options ?? []).map((o) => ({ value: o, label: o }))}
          onChange={onChange}
        />
      );
    case 'number':
    case 'integer': {
      const integer = f.kind === 'integer';
      const n = typeof value === 'number' ? value : undefined;
      const placeholder = typeof base === 'number' ? String(base) : undefined;
      const slider = f.min !== undefined && f.max !== undefined && (!integer || f.max - f.min <= 100_000);
      return (
        <>
          {slider && <Slider min={f.min!} max={f.max!} step={f.step} value={n ?? (base as number) ?? f.min!} changed={changed} onChange={(v) => onChange(integer ? Math.round(v) : +v.toFixed(4))} />}
          <NumberField
            value={changed ? n : undefined}
            placeholder={placeholder}
            min={f.min}
            max={f.max}
            step={f.step}
            integer={integer}
            changed={changed}
            width={slider ? 64 : 96}
            className={slider ? '' : 'ml-auto'}
            onChange={onChange}
          />
        </>
      );
    }
    case 'string':
      return <Input size="sm" changed={changed} value={changed ? String(value ?? '') : ''} placeholder={base !== undefined ? String(base) : ''} onChange={(e) => onChange(e.target.value || undefined)} />;
    case 'tags':
      return <TagInput size="sm" value={Array.isArray(value) ? (value as string[]) : []} onChange={(v) => onChange(v.length ? v : undefined)} />;
    default:
      return null;
  }
}
