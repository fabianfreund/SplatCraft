import { z } from 'zod';
import type {
  SplatCraftPlugin,
  MonitorProvider,
  PipelineTemplate,
  PluginAPI,
  PresetId,
  StageDefinition,
  ToolSpec,
} from './types.js';

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  stages: string[];
  tools: string[];
  monitors: string[];
  pipelines: string[];
}

/** Serializable stage description for the UI (params as JSON Schema). */
export interface StageDescriptor {
  id: string;
  version: string;
  title: string;
  description: string;
  category: string;
  pluginId: string;
  tools: string[];
  inputs: string[];
  outputs: string[];
  resumable: boolean;
  paramsJsonSchema: unknown;
  presets: Partial<Record<PresetId, Record<string, unknown>>>;
}

/**
 * Central registry. Everything — including built-in functionality — enters
 * the app through plugins, so built-ins can be replaced or extended.
 */
export class Registry {
  readonly stages = new Map<string, { def: StageDefinition<any>; pluginId: string }>();
  readonly tools = new Map<string, { spec: ToolSpec; pluginId: string }>();
  readonly monitors = new Map<string, { provider: MonitorProvider; pluginId: string }>();
  readonly pipelines = new Map<string, { template: PipelineTemplate; pluginId: string }>();
  readonly plugins = new Map<string, PluginInfo>();

  async load(plugin: SplatCraftPlugin): Promise<void> {
    if (this.plugins.has(plugin.id)) throw new Error(`Plugin already loaded: ${plugin.id}`);
    const info: PluginInfo = {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      stages: [],
      tools: [],
      monitors: [],
      pipelines: [],
    };
    const api: PluginAPI = {
      registerStage: (def) => {
        // Later registrations override earlier ones → plugins can replace built-ins.
        this.stages.set(def.id, { def, pluginId: plugin.id });
        info.stages.push(def.id);
      },
      registerTool: (spec) => {
        this.tools.set(spec.id, { spec, pluginId: plugin.id });
        info.tools.push(spec.id);
      },
      registerMonitor: (provider) => {
        this.monitors.set(provider.id, { provider, pluginId: plugin.id });
        info.monitors.push(provider.id);
      },
      registerPipeline: (template) => {
        this.pipelines.set(template.id, { template, pluginId: plugin.id });
        info.pipelines.push(template.id);
      },
    };
    await plugin.register(api);
    this.plugins.set(plugin.id, info);
  }

  stage(id: string): StageDefinition<any> {
    const s = this.stages.get(id);
    if (!s) throw new Error(`Unknown stage: ${id}`);
    return s.def;
  }

  describeStages(): StageDescriptor[] {
    return [...this.stages.values()].map(({ def, pluginId }) => ({
      id: def.id,
      version: def.version,
      title: def.title,
      description: def.description,
      category: def.category,
      pluginId,
      tools: def.tools ?? [],
      inputs: def.inputs,
      outputs: def.outputs,
      resumable: !!def.resumable,
      paramsJsonSchema: safeJsonSchema(def.paramsSchema),
      presets: (def.presets ?? {}) as StageDescriptor['presets'],
    }));
  }

  /** Stages that can stand in for `stageId` (same inputs/outputs). */
  alternativesFor(stageId: string): string[] {
    const def = this.stage(stageId);
    const key = (d: StageDefinition<any>) => `${[...d.inputs].sort()}→${[...d.outputs].sort()}`;
    return [...this.stages.values()].filter(({ def: d }) => key(d) === key(def)).map(({ def: d }) => d.id);
  }
}

function safeJsonSchema(schema: z.ZodType): unknown {
  try {
    return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  } catch {
    return { type: 'object' };
  }
}

/** Effective params = schema defaults ← preset ← user overrides, validated. */
export function resolveParams(def: StageDefinition<any>, preset: PresetId, user: Record<string, unknown>) {
  const merged = { ...(def.presets?.[preset] ?? {}), ...user };
  return def.paramsSchema.parse(merged) as Record<string, unknown>;
}
