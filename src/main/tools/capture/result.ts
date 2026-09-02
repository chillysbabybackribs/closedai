import type { ToolResult } from '../tool.js'
import type { CapturedImage } from './host.js'

export function imageResult(summary: string, image: CapturedImage): ToolResult {
  return {
    content: [
      { type: 'text', text: `${summary}\nImage: ${image.width}x${image.height}\nCaptured: ${image.capturedAt}` },
      { type: 'image', dataUrl: image.dataUrl }
    ]
  }
}
