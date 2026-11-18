import type { SourceTrim } from '@shared/api';
import { ArrowLeftToLine, ArrowRightToLine, Film, Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatSeconds } from '../../lib/format';
import { EmptyState, IconButton, Label, NumberField, RangeSlider, Text } from '../../ui';
import { trimmedLength } from './settings';
import type { ImportItem } from './useImport';

const STEP = 0.01;
const EPS = 0.02;

/** A trim covering the whole clip is stored as "no trim". */
export function toTrim(start: number, end: number | undefined, duration: number | undefined): SourceTrim | undefined {
  const s = Math.max(0, +start.toFixed(3));
  const e = end === undefined || (duration !== undefined && end >= duration - EPS) ? undefined : +end.toFixed(3);
  if (e !== undefined && e <= s) return undefined;
  if (s < EPS && e === undefined) return undefined;
  return e === undefined ? { start: s } : { start: s, end: e };
}

/** Video player + in/out trim bar. Remount per item (key) to reset playback. */
export function TrimEditor({ item, url, onPatch }: { item: ImportItem; url: string; onPatch: (p: Partial<ImportItem>) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(item.trim?.start ?? 0);
  const [playing, setPlaying] = useState(false);
  const duration = item.duration;
  const start = item.trim?.start ?? 0;
  const end = item.trim?.end ?? duration;
  const playable = !item.unplayable;

  const setTrim = (s: number, e: number | undefined) => onPatch({ trim: toTrim(s, e, duration) });
  const seek = (t: number) => {
    const v = video.current;
    if (v && playable) v.currentTime = t;
    setTime(t);
  };

  // Smooth playhead while playing; loop inside the trim range.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = video.current;
      if (v) {
        if (end !== undefined && v.currentTime >= end) v.currentTime = start;
        setTime(v.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, start, end]);

  const toggle = () => {
    const v = video.current;
    if (!v || !playable) return;
    if (v.paused) {
      if (v.currentTime < start || (end !== undefined && v.currentTime >= end - EPS)) v.currentTime = start;
      void v.play();
    } else v.pause();
  };

  const length = trimmedLength(duration, item.trim);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-viewport">
        {playable ? (
          <video
            ref={video}
            src={url}
            preload="auto"
            playsInline
            muted
            className="size-full object-contain"
            onClick={toggle}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0 && Math.abs(d - (duration ?? 0)) > EPS) onPatch({ duration: d });
              if (start > 0) e.currentTarget.currentTime = start;
            }}
            onSeeked={(e) => !playing && setTime(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => onPatch({ unplayable: true })}
          />
        ) : (
          <EmptyState icon={Film} title="No preview" />
        )}
      </div>

      <RangeSlider
        min={0}
        max={duration ?? 1}
        step={STEP}
        minGap={0.1}
        value={[start, end ?? duration ?? 1]}
        marker={playable && duration ? time : undefined}
        onSeek={playable ? seek : undefined}
        onChange={([s, e]) => {
          setTrim(s, e);
          seek(s !== start ? s : e);
        }}
        disabled={!duration}
        labels={['Trim start', 'Trim end']}
      />

      <div className="flex h-[var(--sc-control-h)] shrink-0 items-center gap-1.5">
        <IconButton icon={playing ? Pause : Play} label={playing ? 'Pause' : 'Play'} disabled={!playable} onClick={toggle} />
        <Text size="xs" tone="muted" num className="w-[58px]">
          {playable ? formatSeconds(time) : '—'}
        </Text>
        <div className="ml-auto flex items-center gap-1.5">
          <IconButton icon={ArrowLeftToLine} label="Set start to playhead" disabled={!playable} onClick={() => setTrim(Math.min(time, (end ?? Infinity) - 0.1), end)} />
          <NumberField value={start} min={0} max={duration} step={0.1} width={72} suffix="s" changed={start > 0} onChange={(v) => setTrim(Math.min(v ?? 0, (end ?? Infinity) - 0.1), end)} />
          <Text size="xs" tone="faint">
            –
          </Text>
          <NumberField
            value={item.trim?.end}
            placeholder={duration !== undefined ? duration.toFixed(2) : 'end'}
            min={0}
            max={duration}
            step={0.1}
            width={72}
            suffix="s"
            changed={item.trim?.end !== undefined}
            onChange={(v) => setTrim(start, v === undefined ? undefined : Math.max(v, start + 0.1))}
          />
          <IconButton icon={ArrowRightToLine} label="Set end to playhead" disabled={!playable} onClick={() => setTrim(start, Math.max(time, start + 0.1))} />
          <IconButton icon={RotateCcw} size="sm" label="Use whole clip" className={item.trim ? '' : 'invisible'} onClick={() => onPatch({ trim: undefined })} />
        </div>
      </div>
      <div className="flex h-4 shrink-0 items-center gap-1.5">
        <Label>Length</Label>
        <Text size="xs" num tone={item.trim ? 'default' : 'subtle'}>
          {formatSeconds(length)}
        </Text>
        {duration !== undefined && (
          <Text size="2xs" tone="faint" num>
            / {formatSeconds(duration)}
          </Text>
        )}
      </div>
    </div>
  );
}
