import { EventEmitter } from 'node:events';
import { statfs } from 'node:fs/promises';
import os from 'node:os';
import type { MonitorProvider, Registry, SystemSample } from '@splatcraft/core';

const INTERVAL_MS = 1000;
const HISTORY_MS = 5 * 60_000;
const SAMPLE_TIMEOUT_MS = 2500;

/**
 * Samples all supported registry monitors ~1 Hz while at least one renderer
 * is subscribed (or a pipeline is running), merges partial samples (GPUs are
 * concatenated, other fields: first provider wins) and keeps a 5-minute ring
 * buffer. Falls back to Node's `os` for CPU/RAM/disk when no provider does.
 * Emits `sample` with `SystemSample`.
 */
export class MonitorService extends EventEmitter {
  private providers: MonitorProvider[] = [];
  private ready?: Promise<void>;
  private subs = new Map<number, number>();
  private keepAlive = false;
  private timer?: NodeJS.Timeout;
  private busy = false;
  private buffer: SystemSample[] = [];
  private prevCpu = cpuTimes();

  constructor(
    private registry: Registry,
    private context: () => { projectDir?: string; fallbackDir: string },
  ) {
    super();
  }

  init() {
    this.ready ??= (async () => {
      const all = [...this.registry.monitors.values()].map((m) => m.provider);
      const ok = await Promise.all(all.map((p) => withTimeout(p.isSupported(), SAMPLE_TIMEOUT_MS).catch(() => false)));
      this.providers = all.filter((_, i) => ok[i]);
    })();
    return this.ready;
  }

  get supportedProviders() {
    return this.providers.map((p) => p.id);
  }

  history(): SystemSample[] {
    return [...this.buffer];
  }

  subscribers(): number[] {
    return [...this.subs.keys()];
  }

  subscribe(id: number) {
    this.subs.set(id, (this.subs.get(id) ?? 0) + 1);
    this.update();
  }

  unsubscribe(id: number, all = false) {
    const n = (this.subs.get(id) ?? 0) - 1;
    if (all || n <= 0) this.subs.delete(id);
    else this.subs.set(id, n);
    this.update();
  }

  /** Keep sampling (for history) while e.g. a pipeline is running. */
  setKeepAlive(on: boolean) {
    this.keepAlive = on;
    this.update();
  }

  dispose() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private update() {
    const active = this.subs.size > 0 || this.keepAlive;
    if (active && !this.timer) {
      this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
      void this.tick();
    } else if (!active && this.timer) {
      this.dispose();
    }
  }

  /** Take one merged sample now. */
  async sampleOnce(): Promise<SystemSample> {
    await this.init();
    const ctx = this.context();
    const parts = await Promise.all(
      this.providers.map((p) => withTimeout(p.sample({ projectDir: ctx.projectDir }), SAMPLE_TIMEOUT_MS).catch(() => ({}) as Partial<SystemSample>)),
    );
    const merged: SystemSample = { t: Date.now(), gpus: [] };
    for (const part of parts) {
      for (const [k, v] of Object.entries(part ?? {})) {
        if (v === undefined || k === 't') continue;
        if (k === 'gpus') merged.gpus.push(...(v as SystemSample['gpus']));
        else if ((merged as any)[k] === undefined) (merged as any)[k] = v;
      }
    }
    // Fallbacks (cheap, cross-platform).
    const now = cpuTimes();
    if (!merged.cpu) {
      const idle = now.idle - this.prevCpu.idle;
      const total = now.total - this.prevCpu.total;
      merged.cpu = { utilization: total > 0 ? round1(100 * (1 - idle / total)) : 0, cores: os.cpus().length, model: os.cpus()[0]?.model };
    }
    this.prevCpu = now;
    if (!merged.memory) {
      const total = os.totalmem() / 2 ** 20;
      merged.memory = { usedMB: Math.round(total - os.freemem() / 2 ** 20), totalMB: Math.round(total) };
    }
    if (!merged.disk) {
      const dir = ctx.projectDir ?? ctx.fallbackDir;
      try {
        const s = await statfs(dir);
        merged.disk = { freeMB: Math.round((s.bavail * s.bsize) / 2 ** 20), totalMB: Math.round((s.blocks * s.bsize) / 2 ** 20), path: dir };
      } catch {
        /* ignore */
      }
    }
    return merged;
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const s = await this.sampleOnce();
      this.buffer.push(s);
      const cutoff = Date.now() - HISTORY_MS;
      while (this.buffer.length && this.buffer[0]!.t < cutoff) this.buffer.shift();
      this.emit('sample', s);
    } catch (e) {
      console.error('[monitor]', e);
    } finally {
      this.busy = false;
    }
  }
}

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  return { idle, total };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
