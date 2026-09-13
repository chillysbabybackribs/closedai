import { app } from 'electron'
import { summarizeGpuFeatureStatus } from './gpu-feature-status.js'

/** Log GPU feature status once at startup so silent CPU-rasterization fallbacks are visible. */
export function logGpuFeatureStatus(stream: NodeJS.WritableStream = process.stderr): void {
  stream.write(`[gpu] ${JSON.stringify(summarizeGpuFeatureStatus(app.getGPUFeatureStatus()))}\n`)
}
