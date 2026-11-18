import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, chmod, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { runProcess, type PlatformKey, type Registry, type ToolResolver, type ToolSpec, type ToolStatus } from '@splatcraft/core';

const pexec = promisify(execFile);

export function currentPlatform(): PlatformKey {
  return `${process.platform}-${process.arch}` as PlatformKey;
}

export interface ToolchainOptions {
  /** App-managed tools dir, e.g. <userData>/tools. */
  managedDir: string;
  /** Tools shipped inside the installer, e.g. <resources>/tools. */
  bundledDir?: string;
}

/**
 * Finds and installs external tools. Resolution order:
 *   1. env  SPLATCRAFT_TOOL_<ID>=/path/to/exe   (power-user override)
 *   2. managed dir (downloaded by the app)
 *   3. bundled dir (shipped in the installer)
 *   4. PATH (system install, e.g. Homebrew)
 */
export class Toolchain implements ToolResolver {
  private cache = new Map<string, ToolStatus>();

  constructor(
    private registry: Registry,
    private opts: ToolchainOptions,
  ) {}

  private spec(id: string): ToolSpec {
    const t = this.registry.tools.get(id);
    if (!t) throw new Error(`Unknown tool: ${id}`);
    return t.spec;
  }

  async resolve(toolId: string): Promise<{ path: string; version?: string }> {
    const st = await this.status(toolId);
    if (!st.available || !st.path) {
      throw new Error(`${st.name} is not installed. ${st.installHint ?? ''}`.trim());
    }
    return { path: st.path, version: st.version };
  }

  async statusAll(refresh = false): Promise<ToolStatus[]> {
    return Promise.all([...this.registry.tools.keys()].map((id) => this.status(id, refresh)));
  }

  async status(id: string, refresh = false): Promise<ToolStatus> {
    if (!refresh && this.cache.has(id)) return this.cache.get(id)!;
    const spec = this.spec(id);
    const recipe = spec.install?.[currentPlatform()];
    const base: ToolStatus = {
      id,
      name: spec.name,
      available: false,
      installable: !!recipe && recipe.type !== 'manual',
      installHint: recipe?.type === 'manual' ? recipe.instructions : recipe?.type === 'brew' ? `Install with: brew install ${recipe.formula}` : undefined,
    };
    const found = await this.find(spec);
    let st: ToolStatus = base;
    if (found) {
      const v = await this.probeVersion(spec, found.path);
      st = v.ok
        ? { ...base, available: true, path: found.path, source: found.source, version: v.version }
        : { ...base, available: false, path: found.path, source: found.source, error: v.error };
    }
    this.cache.set(id, st);
    return st;
  }

  private async find(spec: ToolSpec): Promise<{ path: string; source: ToolStatus['source'] } | undefined> {
    const envKey = `SPLATCRAFT_TOOL_${spec.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    if (process.env[envKey] && (await exists(process.env[envKey]!))) return { path: process.env[envKey]!, source: 'env' };
    const exeNames = spec.executables.flatMap((e) => (process.platform === 'win32' ? [e + '.exe', e] : [e]));
    for (const [dir, source] of [
      [path.join(this.opts.managedDir, spec.id), 'managed'],
      ...(this.opts.bundledDir ? [[path.join(this.opts.bundledDir, spec.id), 'bundled'] as const] : []),
    ] as const) {
      const hit = await findFile(dir, exeNames, 3);
      if (hit) return { path: hit, source };
    }
    const pathDirs = (process.env.PATH ?? '').split(path.delimiter);
    // GUI apps on macOS don't inherit the shell PATH — add common locations.
    if (process.platform === 'darwin') pathDirs.push('/opt/homebrew/bin', '/usr/local/bin');
    if (process.platform === 'linux') pathDirs.push('/usr/local/bin', '/usr/bin', path.join(process.env.HOME ?? '', '.local/bin'));
    for (const dir of pathDirs) {
      for (const name of exeNames) {
        const p = path.join(dir, name);
        if (await exists(p)) return { path: p, source: 'path' };
      }
    }
    return undefined;
  }

  private async probeVersion(spec: ToolSpec, exe: string): Promise<{ ok: boolean; version?: string; error?: string }> {
    if (!spec.versionArgs) return { ok: true };
    try {
      const { stdout, stderr } = await pexec(exe, spec.versionArgs, { timeout: 15000 });
      const out = `${stdout}\n${stderr}`;
      return { ok: true, version: spec.parseVersion?.(out) ?? out.trim().split('\n')[0]?.slice(0, 80) };
    } catch (e: any) {
      // Many CLIs exit non-zero on --help; accept if they printed something.
      const out = `${e?.stdout ?? ''}\n${e?.stderr ?? ''}`.trim();
      if (out && !/Library not loaded|image not found|cannot open shared object/i.test(out)) {
        return { ok: true, version: spec.parseVersion?.(out) };
      }
      return { ok: false, error: out.split('\n')[0] || String(e?.message ?? e) };
    }
  }

  /** Install a tool for the current platform. Progress: 0..1. */
  async install(id: string, onProgress?: (fraction: number, message: string) => void, signal?: AbortSignal): Promise<ToolStatus> {
    const spec = this.spec(id);
    const recipe = spec.install?.[currentPlatform()];
    if (!recipe) throw new Error(`No installer for ${spec.name} on ${currentPlatform()}`);
    if (recipe.type === 'manual') throw new Error(recipe.instructions);
    if (recipe.type === 'brew') {
      onProgress?.(0, `brew install ${recipe.formula}`);
      const brew = (await exists('/opt/homebrew/bin/brew')) ? '/opt/homebrew/bin/brew' : (await exists('/usr/local/bin/brew')) ? '/usr/local/bin/brew' : 'brew';
      await runProcess(brew, ['install', recipe.formula], { env: { HOMEBREW_NO_AUTO_UPDATE: '1' } }, signal, (l) => onProgress?.(0.5, l));
    } else {
      const dest = path.join(this.opts.managedDir, spec.id);
      await rm(dest, { recursive: true, force: true });
      await mkdir(dest, { recursive: true });
      const file = path.join(dest, path.basename(new URL(recipe.url).pathname));
      await download(recipe.url, file, (f) => onProgress?.(f * 0.9, `Downloading ${spec.name}`), signal);
      if (recipe.sha256) {
        const got = await sha256(file);
        if (got !== recipe.sha256) throw new Error(`Checksum mismatch for ${spec.name}`);
      }
      onProgress?.(0.92, 'Extracting');
      if (recipe.archive !== 'none') {
        // `tar` handles .tar.xz/.tar.gz everywhere and .zip on macOS/Windows 10+.
        await runProcess('tar', ['-xf', file, '-C', dest], {}, signal);
        await rm(file, { force: true });
      }
      const exe = path.join(dest, recipe.binPath);
      if (process.platform !== 'win32') await chmod(exe, 0o755).catch(() => {});
      if (process.platform === 'darwin') await runProcess('xattr', ['-dr', 'com.apple.quarantine', dest]).catch(() => {});
    }
    onProgress?.(1, 'Installed');
    return this.status(id, true);
  }
}

async function download(url: string, file: string, onProgress: (f: number) => void, signal?: AbortSignal) {
  const res = await fetch(url, { signal, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let got = 0;
  let last = 0;
  const body = Readable.fromWeb(res.body as any);
  body.on('data', (c: Buffer) => {
    got += c.length;
    if (total && Date.now() - last > 200) {
      last = Date.now();
      onProgress(got / total);
    }
  });
  await pipeline(body, createWriteStream(file));
}

async function sha256(file: string) {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

async function exists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function findFile(dir: string, names: string[], depth: number): Promise<string | undefined> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const e of entries) if (e.isFile() && names.includes(e.name)) return path.join(dir, e.name);
  if (depth <= 0) return undefined;
  for (const e of entries) {
    if (e.isDirectory()) {
      const hit = await findFile(path.join(dir, e.name), names, depth - 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

/**
 * Per-user tools dir shared by the desktop app and the CLI, so a tool
 * installed by either is found by both (and cache keys stay identical).
 */
export function defaultToolsDir(): string {
  if (process.env.SPLATCRAFT_TOOLS_DIR) return process.env.SPLATCRAFT_TOOLS_DIR;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'SplatCraft', 'tools');
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'SplatCraft', 'tools');
  return path.join(process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), 'SplatCraft', 'tools');
}
