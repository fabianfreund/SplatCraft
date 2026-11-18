import type { SplatCraftPlugin } from '@splatcraft/core';
import { brushPlugin } from './brush/index.js';
import { colmapPlugin } from './colmap/index.js';
import { exportPlugin } from './export/index.js';
import { mediaPlugin } from './media/index.js';
import { monitorPlugin } from './monitor/index.js';
import { pipelinePlugin } from './pipeline/index.js';
import { qualityPlugin } from './quality/index.js';

export { defaultPipeline } from './pipeline/index.js';

/** Built-in plugins. They only talk through the registry, so each can be replaced. */
export const builtinPlugins: SplatCraftPlugin[] = [mediaPlugin, qualityPlugin, colmapPlugin, brushPlugin, exportPlugin, monitorPlugin, pipelinePlugin];
