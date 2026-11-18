import { cn } from './cn';
import { Sparkline } from './Sparkline';
import { Tooltip } from './Tooltip';

export interface MeterProps {
  label: string;
  value: string;
  unit?: string;
  /** Reserved width for the value (px). */
  valueWidth?: number;
  series?: (number | undefined)[];
  min?: number;
  max?: number;
  tone?: 'accent' | 'warning' | 'danger';
  tooltip?: string;
}

/** Compact "LABEL value ~sparkline~" readout for the status dock. Fixed width. */
export function Meter({ label, value, unit, valueWidth = 40, series, min, max, tone = 'accent', tooltip }: MeterProps) {
  const body = (
    <div className="flex h-full shrink-0 items-center gap-1.5 px-2">
      <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-subtle">{label}</span>
      <span
        className={cn('tnum text-right text-xs font-medium', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-fg')}
        style={{ width: valueWidth }}
      >
        {value}
        {unit && <span className="ml-0.5 text-2xs font-normal text-fg-subtle">{unit}</span>}
      </span>
      {series && <Sparkline values={series} min={min} max={max} tone={tone === 'accent' ? 'accent' : tone} width={36} height={14} />}
    </div>
  );
  return tooltip ? (
    <Tooltip content={tooltip} className="h-full">
      {body}
    </Tooltip>
  ) : (
    body
  );
}
