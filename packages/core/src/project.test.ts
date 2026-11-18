import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeTrim, Project } from './project.js';

async function setup() {
  const parentDir = await mkdtemp(path.join(tmpdir(), 'cs-p-'));
  const project = await Project.create({ parentDir, name: 'P', pipeline: { preset: 'balanced', steps: [] } });
  const file = async (name: string) => {
    const p = path.join(parentDir, name);
    await writeFile(p, name);
    return p;
  };
  return { project, file };
}

describe('normalizeTrim', () => {
  it('keeps valid ranges and rounds to milliseconds', () => {
    expect(normalizeTrim({ start: 1.23456, end: 5 })).toEqual({ start: 1.235, end: 5 });
    expect(normalizeTrim({ start: 2 })).toEqual({ start: 2 });
  });
  it('drops whole-clip, empty and invalid ranges', () => {
    expect(normalizeTrim(undefined)).toBeUndefined();
    expect(normalizeTrim({ start: 0 })).toBeUndefined();
    expect(normalizeTrim({ start: 4, end: 4 })).toBeUndefined();
    expect(normalizeTrim({ start: 'x', end: null })).toBeUndefined();
    expect(normalizeTrim({ start: -3, end: 2 })).toEqual({ start: 0, end: 2 });
  });
});

describe('Project sources', () => {
  it('stores a trim for videos only', async () => {
    const { project, file } = await setup();
    const added = await project.addSources(
      [{ path: await file('a.mov'), trim: { start: 1, end: 3 } }, { path: await file('b.jpg'), trim: { start: 1 } }, await file('c.mp4')],
      'link',
    );
    expect(added.map((s) => s.trim)).toEqual([{ start: 1, end: 3 }, undefined, undefined]);
    expect(project.meta.sources).toHaveLength(3);
  });

  it('updates and clears a trim', async () => {
    const { project, file } = await setup();
    const [v] = await project.addSources([await file('v.mp4')], 'copy');
    expect((await project.updateSource(v!.id, { trim: { start: 0.5, end: 2 } })).trim).toEqual({ start: 0.5, end: 2 });
    expect((await project.updateSource(v!.id, { trim: null })).trim).toBeUndefined();
    expect(project.meta.sources[0]!.trim).toBeUndefined();
    await expect(project.updateSource('nope', { trim: null })).rejects.toThrow(/Unknown source/);
  });
});
