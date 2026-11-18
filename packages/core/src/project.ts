import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PipelineSpec, ProjectMeta, SourceEntry, SourceKind } from './types.js';

export const PROJECT_EXT = '.splatcraft';
export const PROJECT_FILE = 'project.json';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.heic', '.heif', '.webp', '.dng', '.exr']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm', '.insv', '.360']);

export function classifySource(file: string): SourceKind {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return 'other';
}

/** Layout of a project folder. All derived data is disposable; sources + project.json are the truth. */
export function projectPaths(dir: string) {
  return {
    root: dir,
    meta: path.join(dir, PROJECT_FILE),
    sources: path.join(dir, 'sources'),
    cache: path.join(dir, 'cache'),
    runs: path.join(dir, 'runs'),
    exports: path.join(dir, 'exports'),
  };
}

export interface CreateProjectInput {
  /** Parent folder; the project folder `<name>.splatcraft` is created inside. */
  parentDir: string;
  name: string;
  description?: string;
  tags?: string[];
  pipeline: PipelineSpec;
}

/**
 * A project on disk. Writes are atomic (temp file + rename) and every
 * mutation goes through `update`, so the file is never half-written.
 */
export class Project {
  private saving: Promise<void> = Promise.resolve();

  private constructor(
    readonly dir: string,
    private _meta: ProjectMeta,
  ) {}

  get meta(): ProjectMeta {
    return this._meta;
  }

  get paths() {
    return projectPaths(this.dir);
  }

  static async create(input: CreateProjectInput): Promise<Project> {
    const safe = input.name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Untitled';
    const dir = path.join(input.parentDir, safe + PROJECT_EXT);
    await mkdir(dir, { recursive: false });
    const now = new Date().toISOString();
    const meta: ProjectMeta = {
      schemaVersion: 1,
      id: randomUUID(),
      name: input.name,
      description: input.description ?? '',
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
      capture: {},
      sources: [],
      pipeline: input.pipeline,
    };
    const p = new Project(dir, meta);
    const paths = p.paths;
    await Promise.all([paths.sources, paths.cache, paths.runs, paths.exports].map((d) => mkdir(d, { recursive: true })));
    await p.save();
    return p;
  }

  static async open(dir: string): Promise<Project> {
    const raw = JSON.parse(await readFile(path.join(dir, PROJECT_FILE), 'utf8')) as ProjectMeta;
    if (raw.schemaVersion !== 1) throw new Error(`Unsupported project schema: ${raw.schemaVersion}`);
    return new Project(dir, raw);
  }

  async update(mutator: (m: ProjectMeta) => void): Promise<ProjectMeta> {
    const next = structuredClone(this._meta);
    mutator(next);
    next.updatedAt = new Date().toISOString();
    this._meta = next;
    await this.save();
    return next;
  }

  /** Saves are queued so concurrent updates can never interleave on disk. */
  private save(): Promise<void> {
    const snapshot = JSON.stringify(this._meta, null, 2);
    const run = async () => {
      const tmp = `${this.paths.meta}.${randomUUID().slice(0, 8)}.tmp`;
      await writeFile(tmp, snapshot);
      await rename(tmp, this.paths.meta);
    };
    this.saving = this.saving.then(run, run);
    return this.saving;
  }

  /** Absolute path of a source entry. */
  sourcePath(s: SourceEntry): string {
    if (s.mode === 'link') return s.path;
    const abs = path.resolve(this.dir, s.path);
    // A tampered project.json must not point copied sources outside the project.
    if (!abs.startsWith(path.join(this.dir, 'sources') + path.sep)) throw new Error(`Invalid source path: ${s.path}`);
    return abs;
  }

  /**
   * Add media. `copy` makes the project self-contained; `link` references
   * files in place (fast for big video). Originals are never modified.
   */
  async addSources(files: string[], mode: 'copy' | 'link' = 'copy'): Promise<SourceEntry[]> {
    const added: SourceEntry[] = [];
    const existing = new Set(this._meta.sources.map((s) => s.name + ':' + s.size));
    for (const file of files) {
      const st = await stat(file);
      if (!st.isFile()) continue;
      const name = path.basename(file);
      if (existing.has(name + ':' + st.size)) continue; // de-dupe re-drops
      const id = randomUUID().slice(0, 8);
      let rel = file;
      if (mode === 'copy') {
        rel = path.join('sources', `${id}_${name}`);
        await copyFile(file, path.join(this.dir, rel));
      }
      added.push({
        id,
        path: rel,
        mode,
        kind: classifySource(file),
        name,
        size: st.size,
        mtimeMs: st.mtimeMs,
        addedAt: new Date().toISOString(),
      });
    }
    if (added.length) await this.update((m) => m.sources.push(...added));
    return added;
  }

  async removeSources(ids: string[]): Promise<void> {
    // Non-destructive: only the reference is removed; copied files stay until "Clean up".
    await this.update((m) => {
      m.sources = m.sources.filter((s) => !ids.includes(s.id));
    });
  }
}
