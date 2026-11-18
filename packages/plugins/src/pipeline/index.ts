import { definePlugin, type PipelineSpec, type PipelineTemplate, type PresetId } from '@splatcraft/core';

export const DEFAULT_PIPELINE_ID = 'splatcraft.default';

export const defaultTemplate: PipelineTemplate = {
  id: DEFAULT_PIPELINE_ID,
  title: 'Photos / video → Gaussian Splat',
  description: 'Frames → quality filter → COLMAP alignment → Brush training → export.',
  steps: [
    { key: 'frames', stageId: 'splatcraft.prepare.frames', enabled: true },
    { key: 'quality', stageId: 'splatcraft.filter.quality', enabled: true },
    { key: 'align', stageId: 'splatcraft.align.colmap', enabled: true },
    { key: 'train', stageId: 'splatcraft.train.brush', enabled: true },
    { key: 'export', stageId: 'splatcraft.export.files', enabled: true },
  ],
};

/** The default step list for new projects (no user overrides). */
export function defaultPipeline(preset: PresetId = 'balanced'): PipelineSpec {
  return { preset, steps: defaultTemplate.steps.map((s) => ({ ...s, params: {} })) };
}

export const pipelinePlugin = definePlugin({
  id: 'splatcraft.pipelines',
  name: 'Default pipelines',
  version: '0.1.0',
  description: 'Built-in pipeline templates.',
  register(api) {
    api.registerPipeline(defaultTemplate);
  },
});
