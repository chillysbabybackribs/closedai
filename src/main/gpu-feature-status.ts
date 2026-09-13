/** Fields from Electron's GPUFeatureStatus that reveal silent software fallbacks. */
export type GpuFeatureStatusSummary = {
  gpu_compositing: string
  video_decode: string
  webgl: string
  '2d_canvas': string
  rasterization: string
}

/** Compact the GPU status fields that reveal silent CPU-rasterization fallbacks. */
export function summarizeGpuFeatureStatus(status: GpuFeatureStatusSummary): GpuFeatureStatusSummary {
  return {
    gpu_compositing: status.gpu_compositing,
    video_decode: status.video_decode,
    webgl: status.webgl,
    '2d_canvas': status['2d_canvas'],
    rasterization: status.rasterization
  }
}
