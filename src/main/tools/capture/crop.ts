import type { ToolAction } from '../action-tool.js'
import { failureResult, numberArg, stringArg } from '../tool.js'
import type { ImageCrop, UiCaptureHostProvider } from './host.js'
import { requireCaptureHost } from './host.js'
import { imageResult } from './result.js'
import type { ScreenshotStore, StoredScreenshot } from './screenshot-store.js'

const MAX_ZOOM = 4

export function cropAction(capture: UiCaptureHostProvider, store: ScreenshotStore): ToolAction {
  return {
    action: 'crop',
    description:
      'Crop and optionally magnify a previous capture for close visual inspection. Pass the ' +
      'Capture ID reported by app_window, browser_page, or another crop. Coordinates use pixels ' +
      'from the model-visible image size reported for that capture, with the origin at its top-left. ' +
      'The crop becomes a new persistent screenshot, so use its Capture ID for further inspection.',
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
      return imageResult(summary, image, 'crop', store, context.callId)
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
