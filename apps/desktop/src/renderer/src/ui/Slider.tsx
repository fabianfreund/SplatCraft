import { cn } from './cn';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  changed?: boolean;
  className?: string;
  disabled?: boolean;
}

export function Slider({ value, min, max, step, onChange, onCommit, changed, className, disabled }: SliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      className={cn('sc-slider no-drag min-w-0 flex-1', changed && 'sc-slider--changed', className)}
      min={min}
      max={max}
      step={step ?? 'any'}
      value={value}
      disabled={disabled}
      style={{ ['--sc-slider-pct' as string]: `${Math.max(0, Math.min(100, pct))}%` }}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
    />
  );
}
