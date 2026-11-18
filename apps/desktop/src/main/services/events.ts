import type { EngineEvent } from '@splatcraft/core';

const PROGRESS_INTERVAL_MS = 100; // ≤ 10/s per (run, step)
const MAX_LOGS = 300;
const MAX_METRICS = 100;
const MAX_PREVIEWS = 60;
const MAX_STRUCTURAL = 200;

interface Seq {
  seq: number;
  e: EngineEvent;
}

/**
 * Forwards engine events to the renderer(s): `stage.progress` is throttled per
 * step (trailing edge, so the last value is never lost); everything else is
 * sent immediately and in order. Keeps a bounded snapshot of the current run
 * for `pipeline.state()` — structural events are kept preferentially so a
 * flood of logs can't evict `stage.start`/`stage.done`.
 */
export class EngineEventHub {
  private seq = 0;
  private structural: Seq[] = [];
  private logs: Seq[] = [];
  private metrics: Seq[] = [];
  private previews: Seq[] = [];
  private progress = new Map<string, Seq>();
  private pending = new Map<string, { e: EngineEvent; timer: NodeJS.Timeout }>();
  private lastSent = new Map<string, number>();

  constructor(private send: (e: EngineEvent) => void) {}

  push(e: EngineEvent) {
    if (e.type === 'run.start') this.reset();
    if (e.type === 'stage.progress') {
      const k = `${e.runId}:${e.key}`;
      const wait = (this.lastSent.get(k) ?? 0) + PROGRESS_INTERVAL_MS - Date.now();
      if (wait <= 0 && !this.pending.has(k)) return this.emit(e, k);
      const p = this.pending.get(k);
      if (p) p.e = e;
      else this.pending.set(k, { e, timer: setTimeout(() => this.flush(k), Math.max(wait, 0)) });
      return;
    }
    if ('key' in e) this.flush(`${e.runId}:${e.key}`);
    else for (const k of [...this.pending.keys()]) this.flush(k); // run.done etc.
    this.emit(e);
  }

  /** Snapshot for a (re)connecting renderer, in emission order. */
  snapshot(): EngineEvent[] {
    return [...this.structural, ...this.logs, ...this.metrics, ...this.previews, ...this.progress.values()]
      .sort((a, b) => a.seq - b.seq)
      .map((s) => s.e);
  }

  reset() {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    this.lastSent.clear();
    this.structural = [];
    this.logs = [];
    this.metrics = [];
    this.previews = [];
    this.progress.clear();
  }

  private flush(k: string) {
    const p = this.pending.get(k);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(k);
    this.emit(p.e, k);
  }

  private emit(e: EngineEvent, progressKey?: string) {
    const s = { seq: ++this.seq, e };
    switch (e.type) {
      case 'stage.progress':
        this.lastSent.set(progressKey!, Date.now());
        this.progress.set(progressKey!, s);
        break;
      case 'stage.log':
        push(this.logs, s, MAX_LOGS);
        break;
      case 'stage.metric':
        push(this.metrics, s, MAX_METRICS);
        break;
      case 'stage.preview':
        push(this.previews, s, MAX_PREVIEWS);
        break;
      default:
        push(this.structural, s, MAX_STRUCTURAL);
    }
    this.send(e);
  }
}

function push<T>(arr: T[], v: T, max: number) {
  arr.push(v);
  if (arr.length > max) arr.splice(0, arr.length - max);
}
