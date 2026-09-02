import type { ToolResult } from '../tool.js'
import type { CapturedImage } from './host.js'
import type { ScreenshotStore, ScreenshotSurface } from './screenshot-store.js'

/** Hand the model the bounded image and keep the full-resolution one for the transcript. */
export function imageResult(
  summary: string,
  image: CapturedImage,
  surface: ScreenshotSurface,
  store: ScreenshotStore,
  callId: string
): ToolResult {
  store.retain(callId, {
    dataUrl: image.dataUrl,
    width: image.width,
    height: image.height,
    modelWidth: image.model.width,
    modelHeight: image.model.height,
    surface,
    capturedAt: image.capturedAt
  })
  const scaled = image.model.width !== image.width || image.model.height !== image.height
  const size = scaled
    ? `${image.model.width}x${image.model.height} (scaled from ${image.width}x${image.height}; the user sees the full capture)`
    : `${image.width}x${image.height}`
  return {
    content: [
      { type: 'text', text: `${summary}\nCapture ID: ${callId}\nImage: ${size}\nCaptured: ${image.capturedAt}` },
      { type: 'image', dataUrl: image.model.dataUrl }
    ]
  }
}
