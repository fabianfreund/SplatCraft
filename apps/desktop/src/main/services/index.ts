import path from 'node:path';
import { app } from 'electron';
import { PipelineEngine, Registry } from '@splatcraft/core';
import { builtinPlugins } from '@splatcraft/plugins';
import { defaultToolsDir, Toolchain } from '@splatcraft/toolchain';
import { MonitorService } from './monitor';
import { ProjectService } from './projects';
import { Updater } from './updater';

export interface Services {
  registry: Registry;
  toolchain: Toolchain;
  engine: PipelineEngine;
  projects: ProjectService;
  monitor: MonitorService;
  updater: Updater;
  /** Plugin load failures (shown in logs; the app still starts). */
  pluginErrors: { id: string; error: string }[];
}

export async function createServices(): Promise<Services> {
  const userData = app.getPath('userData');
  const registry = new Registry();
  const pluginErrors: Services['pluginErrors'] = [];
  for (const plugin of builtinPlugins) {
    try {
      await registry.load(plugin);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      pluginErrors.push({ id: plugin.id, error });
      console.error(`[plugins] failed to load ${plugin.id}:`, error);
    }
  }

  const toolchain = new Toolchain(registry, {
    managedDir: defaultToolsDir(),
    // Packaged: <resources>/tools (electron-builder extraResources). Dev: apps/desktop/resources/tools.
    bundledDir: app.isPackaged ? path.join(process.resourcesPath, 'tools') : path.join(app.getAppPath(), 'resources', 'tools'),
  });
  const engine = new PipelineEngine(registry, toolchain);
  const projects = new ProjectService(registry, userData);
  await projects.init();
  const monitor = new MonitorService(registry, () => ({ projectDir: projects.currentProject?.dir, fallbackDir: userData }));
  void monitor.init();

  const updater = new Updater(userData);

  return { registry, toolchain, engine, projects, monitor, updater, pluginErrors };
}
