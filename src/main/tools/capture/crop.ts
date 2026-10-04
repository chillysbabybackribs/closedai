import type { ToolAction } from '../action-tool.js'
import { failureResult, numberArg, stringArg } from '../tool.js'
import type { ImageCrop, UiCaptureHostProvider } from './host.js'
import { requireCaptureHost } from './host.js'
import type { CaptureDedup } from './dedup.js'
import { imageResult } from './result.js'
import type { ScreenshotStore, StoredScreenshot } from './screenshot-store.js'
import type { AppTargetBounds } from '../app/host.js'

const MAX_ZOOM = 4
/** CSS px kept around a control crop so its border and focus ring stay in frame. */
const CONTROL_PADDING = 8

export function cropAction(capture: UiCaptureHostProvider, store: ScreenshotStore, dedup: CaptureDedup): ToolAction {
  return {
    action: 'crop',
    description:
      'Crop and optionally zoom a retained capture by Capture ID. Coordinates are model-image pixels from that capture\'s reported size.',
    inputSchema: {
      type: 'object',
      properties: {
        source_id: { type: 'string', minLength: 1, description: 'Capture ID of the source screenshot.' },
        x: { type: 'integer', minimum: 0, description: 'Crop left edge in source model-image pixels.' },
        y: { type: 'integer', minimum: 0, description: 'Crop top edge in source model-image pixels.' },
        width: { type: 'integer', minimum: 1, description: 'Crop width in source model-image pixels.' },
        height: { type: 'integer', minimum: 1, description: 'Crop height in source model-image pixels.' },
        zoom: {
          type: 'number', minimum: 1, maximum: MAX_ZOOM,
          description: `Optional output magnification from 1x to ${MAX_ZOOM}x; fractional values are supported. Defaults to 1.`
        }
      },
      required: ['source_id', 'x', 'y', 'width', 'height'],
      additionalProperties: false
    },
    async run(input, context) {
      const sourceId = stringArg(input, 'source_id') ?? ''
      const source = store.get(sourceId)
      if (!source) return failureResult(`No retained screenshot with Capture ID ${sourceId}`)
      const region = {
        x: numberArg(input, 'x', 0),
        y: numberArg(input, 'y', 0),
        width: numberArg(input, 'width', 0),
        height: numberArg(input, 'height', 0)
      }
      const zoom = numberArg(input, 'zoom', 1)
      if (region.x + region.width > source.modelWidth || region.y + region.height > source.modelHeight) {
        return failureResult(
          `Crop (${region.x}, ${region.y}, ${region.width}x${region.height}) exceeds source image ` +
          `${source.modelWidth}x${source.modelHeight}`
        )
      }
      const crop = displayCrop(source, region)
      const image = await requireCaptureHost(capture).cropImage(source.dataUrl, crop, zoom)
      if (!image) return failureResult('The retained screenshot could not be decoded or cropped')
      const summary =
        `Crop of: ${sourceId}\nRegion: (${region.x}, ${region.y}) ${region.width}x${region.height} ` +
        `of ${source.modelWidth}x${source.modelHeight}${zoom > 1 ? `\nZoom: ${zoom}x` : ''}`
      return imageResult(
        summary, image, 'crop', store, context.callId, dedup, context.turnId,
        `crop:${sourceId}:${region.x},${region.y},${region.width},${region.height},${zoom}`
      )
    }
  }
}

function displayCrop(source: StoredScreenshot, region: ImageCrop): ImageCrop {
  const scaleX = source.width / source.modelWidth
  const scaleY = source.height / source.modelHeight
  const x = Math.floor(region.x * scaleX)
  const y = Math.floor(region.y * scaleY)
  const right = Math.min(source.width, Math.ceil((region.x + region.width) * scaleX))
  const bottom = Math.min(source.height, Math.ceil((region.y + region.height) * scaleY))
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
}

/** A control's viewport CSS box mapped onto the captured window bitmap, padded and clamped; null when nothing is left. */
export function controlCrop(image: { width: number; height: number }, located: AppTargetBounds): ImageCrop | null {
  const scaleX = located.viewport.width > 0 ? image.width / located.viewport.width : 1
  const scaleY = located.viewport.height > 0 ? image.height / located.viewport.height : 1
  const { bounds } = located
  const x = Math.max(0, Math.floor((bounds.x - CONTROL_PADDING) * scaleX))
  const y = Math.max(0, Math.floor((bounds.y - CONTROL_PADDING) * scaleY))
  const right = Math.min(image.width, Math.ceil((bounds.x + bounds.width + CONTROL_PADDING) * scaleX))
  const bottom = Math.min(image.height, Math.ceil((bounds.y + bounds.height + CONTROL_PADDING) * scaleY))
  return right - x >= 1 && bottom - y >= 1 ? { x, y, width: right - x, height: bottom - y } : null
}
