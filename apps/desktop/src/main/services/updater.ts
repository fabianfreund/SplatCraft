import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateState } from '@shared/api';

const { autoUpdater } = electronUpdater;

/** How often a running app looks for a new GitHub release. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Auto-update from the newest GitHub release (electron-updater, `publish` in
 * electron-builder.yml). Downloads in the background and installs on quit,
 * or right away with `install()`. Only packaged builds update; in dev the
 * state stays `unsupported`.
 *
 * Emits `state` with an `UpdateState` whenever it changes.
 */
export class Updater extends EventEmitter {
  private current: UpdateState;
  private timer?: NodeJS.Timeout;
  private file: string;

  constructor(userData: string) {
    super();
    this.file = path.join(userData, 'updates.json');
    // Linux .deb (and anything else without an update channel) can't self-update.
    const supported = app.isPackaged && (process.platform !== 'linux' || !!process.env['APPIMAGE']);
    this.current = { status: supported ? 'idle' : 'unsupported', version: app.getVersion(), auto: readAuto(this.file) };
    if (!supported) return;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = null;
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }));
    autoUpdater.on('update-not-available', () => this.set({ status: 'current', checkedAt: new Date().toISOString() }));
    autoUpdater.on('update-available', (info) => this.set({ status: 'downloading', available: info.version, fraction: 0 }));
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', fraction: p.percent / 100 }));
    autoUpdater.on('update-downloaded', (info) => this.set({ status: 'ready', available: info.version, fraction: 1, checkedAt: new Date().toISOString() }));
    autoUpdater.on('error', (e) => this.set({ status: 'error', error: readable(e) }));
  }

  get state(): UpdateState {
    return this.current;
  }

  /** First check shortly after launch, then every few hours (when automatic checks are on). */
  start() {
    this.stop();
    if (!this.current.auto || this.current.status === 'unsupported') return;
    this.timer = setTimeout(() => {
      void this.check();
      this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
    }, 10_000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  async check(): Promise<UpdateState> {
    const s = this.current.status;
    if (s === 'unsupported' || s === 'checking' || s === 'downloading' || s === 'ready') return this.current;
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      this.set({ status: 'error', error: readable(e) });
    }
    return this.current;
  }

  /** Turns automatic checks on or off (persisted in `<userData>/updates.json`). */
  async setAuto(auto: boolean): Promise<UpdateState> {
    this.set({ auto });
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify({ auto }, null, 2));
    this.start();
    return this.current;
  }

  /** Quits and installs a downloaded update. */
  install() {
    if (this.current.status !== 'ready') throw new Error('No update has been downloaded yet');
    // Let windows close normally (before-quit cancels a running pipeline).
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  }

  private set(patch: Partial<UpdateState>) {
    const next: UpdateState = { ...this.current, ...patch };
    if (patch.status && patch.status !== 'error') delete next.error;
    if (patch.status && patch.status !== 'downloading' && patch.status !== 'ready') delete next.fraction;
    this.current = next;
    this.emit('state', next);
  }
}

function readAuto(file: string): boolean {
  try {
    return JSON.parse(readFileSync(file, 'utf8')).auto !== false;
  } catch {
    return true;
  }
}

function readable(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // A release without update metadata yet (e.g. CI still building this platform).
  if (/404|latest.*\.yml|Cannot find/i.test(msg)) return 'No update found for this platform yet.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::/i.test(msg)) return 'Could not reach GitHub.';
  return msg.split('\n')[0]!.slice(0, 200);
}
