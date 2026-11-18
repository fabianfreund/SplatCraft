import { Pipette } from 'lucide-react';
import { cn } from './cn';
import { Tooltip } from './Tooltip';

export interface SwatchOption {
  value: string;
  label: string;
}

/** Row of round color swatches plus an optional custom color well. Fixed 22px cells. */
export function SwatchPicker({ value, options, onChange, custom = true, ariaLabel }: { value: string; options: readonly SwatchOption[]; onChange: (v: string) => void; custom?: boolean; ariaLabel?: string }) {
  const isPreset = options.some((o) => o.value.toLowerCase() === value.toLowerCase());
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="no-drag flex items-center gap-1.5">
      {options.map((o) => {
        const active = o.value.toLowerCase() === value.toLowerCase();
        return (
          <Tooltip key={o.value} content={o.label} side="bottom">
            <button
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={o.label}
              onClick={() => onChange(o.value)}
              className={cn(
                'flex size-[22px] items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-surface-2 transition-shadow duration-150',
                active ? 'ring-2 ring-fg-muted' : 'hover:ring-2 hover:ring-line-strong',
              )}
              style={{ background: o.value }}
            />
          </Tooltip>
        );
      })}
      {custom && (
        <Tooltip content="Custom" side="bottom">
          <label
            className={cn(
              'relative flex size-[22px] cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface-3 text-fg-muted ring-offset-2 ring-offset-surface-2 transition-shadow duration-150',
              !isPreset ? 'ring-2 ring-fg-muted' : 'hover:ring-2 hover:ring-line-strong',
            )}
            style={!isPreset ? { background: value } : undefined}
          >
            {isPreset && <Pipette size={11} />}
            <input type="color" aria-label="Custom color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
          </label>
        </Tooltip>
      )}
    </div>
  );
}
