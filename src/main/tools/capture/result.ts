import type { ToolResult } from '../tool.js'
import type { CapturedImage } from './host.js'
import type { ScreenshotStore } from './screenshot-store.js'

/** Hand the model the bounded image and keep the full-resolution one for the transcript. */
export function imageResult(
  summary: string,
  image: CapturedImage,
  surface: 'app_window' | 'browser_page',
  store: ScreenshotStore,
  callId: string
): ToolResult {
  store.retain(callId, { dataUrl: image.dataUrl, width: image.width, height: image.height, surface, capturedAt: image.capturedAt })
  const scaled = image.model.width !== image.width || image.model.height !== image.height
  const size = scaled
    ? `${image.model.width}x${image.model.height} (scaled from ${image.width}x${image.height}; the user sees the full capture)`
    : `${image.width}x${image.height}`
  return {
    content: [
      { type: 'text', text: `${summary}\nImage: ${size}\nCaptured: ${image.capturedAt}` },
      { type: 'image', dataUrl: image.model.dataUrl }
    ]
  }
}
