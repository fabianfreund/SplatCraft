import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import { PROJECT_FILE, Project, type PipelineSpec, type ProjectMeta, type Registry } from '@splatcraft/core';
import { defaultPipeline } from '@splatcraft/plugins';
import type { OpenProject, RecentProject } from '@shared/api';

interface RecentEntry {
  dir: string;
  name: string;
  openedAt: string;
  thumbnail?: string;
}

const MAX_RECENT = 20;
const THUMB_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * Owns the currently open project and the recent-projects list
 * (`<userData>/recent.json`). Emits `changed` with `OpenProject | null`.
 */
export class ProjectService extends EventEmitter {
  private project?: Project;
  private recentList: RecentEntry[] = [];
  private lastThumbAt = 0;

  constructor(
    private registry: Registry,
    private userData: string,
  ) {
    super();
  }

  private get recentFile() {
    return path.join(this.userData, 'recent.json');
  }

  get thumbsDir() {
    return path.join(this.userData, 'thumbnails');
  }

  async init() {
    try {
      const raw = JSON.parse(await readFile(this.recentFile, 'utf8'));
      if (Array.isArray(raw)) this.recentList = raw.filter((r) => r && typeof r.dir === 'string');
    } catch {
      this.recentList = [];
    }
  }

  get currentProject(): Project | undefined {
    return this.project;
  }

  current(): OpenProject | null {
    return this.project ? { dir: this.project.dir, meta: this.project.meta } : null;
  }

  require(): Project {
    if (!this.project) throw new Error('No project is open');
    return this.project;
  }

  recentDirs(): string[] {
    return this.recentList.map((r) => r.dir);
  }

  async recent(): Promise<RecentProject[]> {
    return Promise.all(
      this.recentList.map(async (r) => {
        const exists = existsSync(path.join(r.dir, PROJECT_FILE));
        let thumbnail = r.thumbnail && existsSync(r.thumbnail) ? r.thumbnail : undefined;
        if (!thumbnail && exists) thumbnail = await this.firstImageSource(r.dir);
        return { dir: r.dir, name: r.name, openedAt: r.openedAt, thumbnail, exists };
      }),
    );
  }

  async removeRecent(dir: string) {
    this.recentList = this.recentList.filter((r) => r.dir !== dir);
    await this.saveRecent();
  }

  async create(input: { name: string; description?: string; tags?: string[]; parentDir?: string; template?: string }) {
    const name = String(input?.name ?? '').trim();
    if (!name) throw new Error('Project name is required');
    let parentDir = input.parentDir;
    if (!parentDir) {
      const res = await this.showOpenDialog({
        title: 'Choose where to create the project',
        buttonLabel: 'Create Here',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (res.canceled || !res.filePaths[0]) return null;
      parentDir = res.filePaths[0];
    }
    if (!path.isAbsolute(parentDir)) throw new Error('parentDir must be an absolute path');
    await mkdir(parentDir, { recursive: true });
    const project = await Project.create({
      parentDir,
      name,
      description: input.description,
      tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
      pipeline: this.pipelineFor(input.template),
    });
    await this.setCurrent(project);
    return this.current();
  }

  /** Builds the initial pipeline: a registered template if it matches, else the default. */
  private pipelineFor(template?: string): PipelineSpec {
    const tpl = template ? this.registry.pipelines.get(template)?.template : undefined;
    if (tpl) {
      return {
        preset: 'balanced',
        steps: tpl.steps.filter((s) => this.registry.stages.has(s.stageId)).map((s) => ({ ...s, params: {} })),
      };
    }
    return defaultPipeline('balanced');
  }

  async open(dir?: string) {
    if (!dir) {
      const res = await this.showOpenDialog({
        title: 'Open SplatCraft project',
        buttonLabel: 'Open',
        // macOS can pick either the .splatcraft folder or its project.json.
        properties: process.platform === 'darwin' ? ['openDirectory', 'openFile'] : ['openDirectory'],
        filters: process.platform === 'darwin' ? [{ name: 'SplatCraft project', extensions: ['splatcraft', 'json'] }] : undefined,
      });
      if (res.canceled || !res.filePaths[0]) return null;
      dir = res.filePaths[0];
    }
    dir = path.resolve(dir);
    if (path.basename(dir) === PROJECT_FILE) dir = path.dirname(dir);
    if (!existsSync(path.join(dir, PROJECT_FILE))) throw new Error(`Not a SplatCraft project (no ${PROJECT_FILE}): ${dir}`);
    if (this.project?.dir === dir) {
      await this.touchRecent(this.project);
      return this.current();
    }
    const project = await Project.open(dir);
    await this.setCurrent(project);
    return this.current();
  }

  async close() {
    if (!this.project) return;
    this.project = undefined;
    this.emit('changed', null);
  }

  async updateMeta(patch: Partial<Pick<ProjectMeta, 'name' | 'description' | 'tags' | 'capture'>>) {
    const p = this.require();
    const meta = await p.update((m) => {
      if (typeof patch?.name === 'string' && patch.name.trim()) m.name = patch.name.trim();
      if (typeof patch?.description === 'string') m.description = patch.description;
      if (Array.isArray(patch?.tags)) m.tags = patch.tags.map(String);
      if (patch?.capture && typeof patch.capture === 'object') m.capture = { ...m.capture, ...patch.capture };
    });
    if (patch?.name) await this.touchRecent(p);
    this.notify();
    return meta;
  }

  /** Called after any mutation of the current project from main. */
  notify() {
    this.emit('changed', this.current());
  }

  /** Records the latest preview image as the project thumbnail (downscaled with sharp, ≤ 1/min). */
  async notePreviewImage(src: string) {
    const p = this.project;
    if (!p || !THUMB_EXT.has(path.extname(src).toLowerCase())) return;
    if (Date.now() - this.lastThumbAt < 60_000) return;
    this.lastThumbAt = Date.now();
    const out = path.join(this.thumbsDir, `${p.meta.id}.jpg`);
    try {
      await mkdir(this.thumbsDir, { recursive: true });
      const sharp = (await import('sharp')).default;
      await sharp(src).rotate().resize(480, 320, { fit: 'cover' }).jpeg({ quality: 80 }).toFile(out + '.tmp');
      await rename(out + '.tmp', out);
    } catch {
      return; // thumbnails are best-effort
    }
    const entry = this.recentList.find((r) => r.dir === p.dir);
    if (entry) {
      entry.thumbnail = out;
      await this.saveRecent();
    }
  }

  private async setCurrent(project: Project) {
    this.project = project;
    this.lastThumbAt = 0;
    await this.touchRecent(project);
    this.notify();
  }

  private async touchRecent(project: Project) {
    const prev = this.recentList.find((r) => r.dir === project.dir);
    this.recentList = [
      { dir: project.dir, name: project.meta.name, openedAt: new Date().toISOString(), thumbnail: prev?.thumbnail },
      ...this.recentList.filter((r) => r.dir !== project.dir),
    ].slice(0, MAX_RECENT);
    await this.saveRecent();
  }

  private async saveRecent() {
    await mkdir(this.userData, { recursive: true });
    const tmp = this.recentFile + '.tmp';
    await writeFile(tmp, JSON.stringify(this.recentList, null, 2));
    await rename(tmp, this.recentFile);
  }

  private async firstImageSource(dir: string): Promise<string | undefined> {
    try {
      const meta = JSON.parse(await readFile(path.join(dir, PROJECT_FILE), 'utf8')) as ProjectMeta;
      for (const s of meta.sources ?? []) {
        // Only copied sources: they live inside the project dir, which sc-file may serve.
        if (s.mode !== 'copy' || s.kind !== 'image' || !THUMB_EXT.has(path.extname(s.name).toLowerCase())) continue;
        const abs = path.join(dir, s.path);
        if ((await stat(abs).catch(() => undefined))?.isFile()) return abs;
      }
    } catch {
      /* ignore */
    }
    return undefined;
  }

  private showOpenDialog(opts: OpenDialogOptions) {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    return win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts);
  }
}
