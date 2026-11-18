import { readdir, readFile, statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { definePlugin, type GpuSample, type MonitorProvider, type SystemSample } from '@splatcraft/core';
import { execText, exists } from '../util/fs.js';

const MB = 1024 * 1024;

/* ---------------- CPU / memory / disk ---------------- */

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/** macOS: os.freemem() excludes reclaimable cache; use vm_stat like Activity Monitor. */
async function darwinUsedMB(): Promise<number | undefined> {
  try {
    const out = await execText('/usr/bin/vm_stat', [], 300);
    const page = Number(/page size of (\d+)/.exec(out)?.[1] ?? 16384);
    const get = (k: string) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(out)?.[1] ?? 0);
    // "Memory used" ≈ app (anonymous) + wired + compressed.
    const used = (get('Anonymous pages') - get('Pages purgeable') + get('Pages wired down') + get('Pages occupied by compressor')) * page;
    return used > 0 ? used / MB : undefined;
  } catch {
    return undefined;
  }
}

export function cpuMemProvider(): MonitorProvider {
  let prev = cpuTimes();
  return {
    id: 'cpu-mem',
    name: 'CPU, memory and disk',
    isSupported: async () => true,
    async sample(ctx) {
      let now = cpuTimes();
      if (now.total - prev.total < 50) {
        // First call (or called too quickly): measure over a short window.
        await new Promise((r) => setTimeout(r, 100));
        now = cpuTimes();
      }
      const dt = now.total - prev.total;
      const utilization = dt > 0 ? Math.max(0, Math.min(100, (1 - (now.idle - prev.idle) / dt) * 100)) : 0;
      prev = now;
      const totalMB = os.totalmem() / MB;
      const usedMB = (process.platform === 'darwin' ? await darwinUsedMB() : undefined) ?? (os.totalmem() - os.freemem()) / MB;
      const out: Partial<SystemSample> = {
        t: Date.now(),
        cpu: { utilization: round(utilization), cores: os.cpus().length, model: os.cpus()[0]?.model?.trim() },
        memory: { usedMB: Math.round(usedMB), totalMB: Math.round(totalMB) },
      };
      const dir = ctx.projectDir ?? os.homedir();
      try {
        const s = await statfs(dir);
        out.disk = { freeMB: Math.round((s.bavail * s.bsize) / MB), totalMB: Math.round((s.blocks * s.bsize) / MB), path: dir };
      } catch {
        /* path missing */
      }
      return out;
    },
  };
}

/* ---------------- Apple GPU (IOKit via ioreg) ---------------- */

export function parseIoregAccelerator(out: string): GpuSample | undefined {
  const stats = /"PerformanceStatistics"\s*=\s*\{([^}]*)\}/.exec(out)?.[1];
  if (!stats) return undefined;
  const num = (k: string) => {
    const m = new RegExp(`"${k.replace(/[()%]/g, '\\$&')}"=(\\d+)`).exec(stats);
    return m ? Number(m[1]) : undefined;
  };
  const model = /"model"\s*=\s*"([^"]+)"/.exec(out)?.[1] ?? 'Apple GPU';
  const inUse = num('In use system memory');
  return {
    name: model,
    vendor: 'apple',
    utilization: num('Device Utilization %'),
    vramUsedMB: inUse !== undefined ? Math.round(inUse / MB) : undefined,
    // Unified memory: the GPU can use most of system RAM.
    vramTotalMB: Math.round(os.totalmem() / MB),
  };
}

export function appleGpuProvider(): MonitorProvider {
  return {
    id: 'apple-gpu',
    name: 'Apple GPU',
    isSupported: async () => process.platform === 'darwin' && (await exists('/usr/sbin/ioreg')),
    async sample() {
      try {
        const gpu = parseIoregAccelerator(await execText('/usr/sbin/ioreg', ['-r', '-d', '1', '-c', 'IOAccelerator'], 1000));
        return gpu ? { gpus: [gpu] } : {};
      } catch {
        return {};
      }
    },
  };
}

/* ---------------- NVIDIA (nvidia-smi) ---------------- */

export function parseNvidiaSmi(out: string): GpuSample[] {
  const n = (s: string | undefined) => {
    const v = Number(s?.trim());
    return Number.isFinite(v) && s?.trim() !== '' ? v : undefined;
  };
  return out
    .split(/\r?\n/)
    .filter((l) => l.includes(','))
    .map((l) => {
      const [name, util, used, total, temp, power] = l.split(',');
      return { name: name.trim(), vendor: 'nvidia' as const, utilization: n(util), vramUsedMB: n(used), vramTotalMB: n(total), temperatureC: n(temp), powerW: n(power) };
    });
}

export function nvidiaProvider(): MonitorProvider {
  const exe = process.platform === 'win32' ? 'nvidia-smi.exe' : 'nvidia-smi';
  let supported: Promise<boolean> | undefined;
  return {
    id: 'nvidia',
    name: 'NVIDIA GPU',
    isSupported: () =>
      (supported ??= process.platform === 'darwin' ? Promise.resolve(false) : execText(exe, ['-L'], 1500).then((o) => /GPU \d/.test(o), () => false)),
    async sample() {
      try {
        const out = await execText(exe, ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw', '--format=csv,noheader,nounits'], 1500);
        return { gpus: parseNvidiaSmi(out) };
      } catch {
        return {};
      }
    },
  };
}

/* ---------------- Linux sysfs (AMD; Intel has no util counter) ---------------- */

async function drmCards(): Promise<string[]> {
  const base = '/sys/class/drm';
  const names = await readdir(base).catch(() => [] as string[]);
  const cards = names.filter((n) => /^card\d+$/.test(n)).map((n) => path.join(base, n, 'device'));
  const out: string[] = [];
  for (const c of cards) if (await exists(path.join(c, 'gpu_busy_percent'))) out.push(c);
  return out;
}

export function linuxSysfsProvider(): MonitorProvider {
  let cards: Promise<string[]> | undefined;
  const read = (f: string) => readFile(f, 'utf8').then((s) => Number(s.trim()), () => undefined);
  return {
    id: 'linux-sysfs',
    name: 'AMD GPU (sysfs)',
    isSupported: async () => process.platform === 'linux' && (await (cards ??= drmCards())).length > 0,
    async sample() {
      const list = await (cards ??= drmCards());
      const gpus: GpuSample[] = [];
      for (const dev of list) {
        const [util, used, total] = await Promise.all([
          read(path.join(dev, 'gpu_busy_percent')),
          read(path.join(dev, 'mem_info_vram_used')),
          read(path.join(dev, 'mem_info_vram_total')),
        ]);
        let temp: number | undefined;
        const hw = await readdir(path.join(dev, 'hwmon')).catch(() => [] as string[]);
        if (hw[0]) temp = await read(path.join(dev, 'hwmon', hw[0], 'temp1_input')).then((v) => (v ? v / 1000 : undefined));
        const name = (await readFile(path.join(dev, 'product_name'), 'utf8').catch(() => '')).trim() || `AMD GPU (${path.basename(path.dirname(dev))})`;
        gpus.push({
          name,
          vendor: 'amd',
          utilization: util,
          vramUsedMB: used !== undefined ? Math.round(used / MB) : undefined,
          vramTotalMB: total !== undefined ? Math.round(total / MB) : undefined,
          temperatureC: temp,
        });
      }
      return { gpus };
    },
  };
}

function round(v: number) {
  return Math.round(v * 10) / 10;
}

export const monitorPlugin = definePlugin({
  id: 'splatcraft.monitor',
  name: 'System monitor',
  version: '0.1.0',
  description: 'CPU, memory, disk and GPU statistics (Apple, NVIDIA, AMD).',
  register(api) {
    api.registerMonitor(cpuMemProvider());
    api.registerMonitor(appleGpuProvider());
    api.registerMonitor(nvidiaProvider());
    api.registerMonitor(linuxSysfsProvider());
  },
});
