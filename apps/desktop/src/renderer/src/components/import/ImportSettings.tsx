import type { StageDescriptor } from '@shared/api';
import { Copy, Link2, RotateCcw } from 'lucide-react';
import { PRESETS } from '../../lib/presets';
import { formatNumber } from '../../lib/format';
import { useApp } from '../../store/app';
import { Field, IconButton, NumberField, Section, SegmentedControl, Slider, Stat } from '../../ui';
import { ParamForm } from '../params/ParamForm';
import { estimateFrames, keyFields, paramValue } from './settings';
import type { ImportDraft, ImportItem } from './useImport';

/**
 * Preset + the key knobs of the step that consumes the media (Simple),
 * and that step's full form plus the import mode under Details.
 */
export function ImportSettings({
  descriptor,
  draft,
  items,
  showMode,
  onDraft,
}: {
  descriptor?: StageDescriptor;
  draft: ImportDraft;
  items: ImportItem[];
  showMode: boolean;
  onDraft: (p: Partial<ImportDraft>) => void;
}) {
  const advanced = useApp((s) => s.mode === 'advanced');
  const setParam = (key: string, v: unknown) => {
    const params = { ...draft.params };
    if (v === undefined) delete params[key];
    else params[key] = v;
    onDraft({ params });
  };
  const estimate = estimateFrames(items, descriptor, draft.preset, draft.params);

  return (
    <div className="flex flex-col gap-1 py-1">
      <Section title="Preset" help={PRESETS.find((p) => p.id === draft.preset)?.help}>
        <div className="px-3 pb-2">
          <SegmentedControl
            size="sm"
            ariaLabel="Preset"
            value={draft.preset}
            onChange={(preset) => onDraft({ preset })}
            options={PRESETS.map((p) => ({ value: p.id, label: p.title, icon: p.icon, tooltip: `${p.help} (${p.meta})` }))}
          />
        </div>
      </Section>

      {descriptor && (
        <Section title={descriptor.title} help={descriptor.description}>
          <div className="flex flex-col gap-1 px-3 pb-2">
            {keyFields(descriptor).map((f) => {
              const changed = Object.prototype.hasOwnProperty.call(draft.params, f.key);
              const value = paramValue(descriptor, draft.preset, draft.params, f.key) as number | undefined;
              const integer = f.kind === 'integer';
              return (
                <Field
                  key={f.key}
                  label={f.title}
                  help={f.description}
                  trailing={<IconButton icon={RotateCcw} size="xs" label="Reset to preset" className={changed ? '' : 'invisible'} onClick={() => setParam(f.key, undefined)} />}
                >
                  {f.min !== undefined && f.max !== undefined && (
                    <Slider min={f.min} max={f.max} step={f.step ?? (integer ? 1 : 0.1)} value={value ?? f.min} changed={changed} onChange={(v) => setParam(f.key, integer ? Math.round(v) : +v.toFixed(2))} />
                  )}
                  <NumberField value={changed ? value : undefined} placeholder={value !== undefined ? String(value) : undefined} min={f.min} max={f.max} step={f.step} integer={integer} changed={changed} width={64} onChange={(v) => setParam(f.key, v)} />
                </Field>
              );
            })}
            <div className="flex h-11 items-end">
              <Stat label="Frames" value={estimate ? `${estimate.partial ? '≥ ' : '~'}${formatNumber(estimate.frames)}` : '—'} minWidth={72} tone="accent" />
            </div>
          </div>
        </Section>
      )}

      <Section title="Details" collapsible defaultOpen={advanced}>
        <div className="flex flex-col gap-1 px-3 pb-3">
          {showMode && (
            <Field label="Import" help="Copy makes the project self-contained. Link keeps large files where they are.">
              <SegmentedControl
                size="sm"
                ariaLabel="Import mode"
                value={draft.mode}
                onChange={(mode) => onDraft({ mode })}
                options={[
                  { value: 'copy', label: 'Copy', icon: Copy },
                  { value: 'link', label: 'Link', icon: Link2 },
                ]}
              />
            </Field>
          )}
          {descriptor && <ParamForm descriptor={descriptor} preset={draft.preset} params={draft.params} onChange={(params) => onDraft({ params })} />}
        </div>
      </Section>
    </div>
  );
}
