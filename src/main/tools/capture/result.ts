import type { ToolResult } from '../tool.js'
import type { CapturedImage } from './host.js'
import type { ScreenshotStore, ScreenshotSurface } from './screenshot-store.js'

/** Below this fraction of the source width (a 2560-wide window lands at 50%), UI text in the model copy stops being readable; a 1920-wide one (67%) still reads. */
const LEGIBLE_SCALE = 0.6

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
  const scale = image.model.width / image.width
  const scaled = image.model.width !== image.width || image.model.height !== image.height
  const size = scaled
    ? `${image.model.width}x${image.model.height} (scaled from ${image.width}x${image.height}; the user sees the full capture)`
    : `${image.width}x${image.height}`
  // A wide window shrinks to a fraction of its size; the model tends to re-capture when text
  // is illegible, and a crop of the retained full capture answers that for one image.
  const hint = scale < LEGIBLE_SCALE
    ? `\nScaled to ${Math.round(scale * 100)}%: small text may be unreadable. Use crop with zoom on this capture ID for detail instead of capturing again.`
    : ''
  return {
    content: [
      {
        type: 'text',
        text: `${summary}\nCapture ID: ${callId}\nImage: ${size}${hint}\nCaptured: ${image.capturedAt}\n${EXEC_IMAGE_HINT}`
      },
      { type: 'image', dataUrl: image.model.dataUrl }
    ]
  }
}

/**
 * Code-mode models receive this result as one string with the JPEG data URL after the text.
 * Repeating the split recipe in every result (not only the tool description, which a
 * compaction can leave behind) is what stops `text(JSON.stringify(r))` dumping the image as
 * base64 text — 10k tokens of noise and no picture.
 */
export const EXEC_IMAGE_HINT =
  'exec scripts: const i = r.indexOf("data:image/"); text(r.slice(0, i)); image(r.slice(i)); — never text() the whole result.'
