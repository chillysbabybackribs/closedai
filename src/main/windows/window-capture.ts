import type { Rectangle, WebContents } from 'electron'
import type { AppWindowRegion } from '../../shared/app-windows.js'

/** Wide enough to stay sharp while a still glides up to full size, small enough to keep per space. */
const STILL_WIDTH = 1600
const STILL_QUALITY = 80

/** The page region in the window's own coordinates (CSS pixels scaled by the page zoom), or null. */
export function captureRect(region: AppWindowRegion, zoomFactor: number): Rectangle | null {
  const values = [region?.x, region?.y, region?.width, region?.height]
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) return null
  const [x, y, width, height] = values.map((value) => Math.round(value * zoomFactor)) as [number, number, number, number]
  return width > 0 && height > 0 ? { x: Math.max(0, x), y: Math.max(0, y), width, height } : null
}

/**
 * A JPEG still of the calling window's own page. Native views such as the browser paint outside the
 * page, so a caller that wants them shows their captured stills first. Null when nothing painted.
 */
export async function captureWindowRegion(contents: WebContents, region: AppWindowRegion): Promise<string | null> {
  const rect = captureRect(region, contents.getZoomFactor())
  if (!rect || contents.isDestroyed()) return null
  const image = await contents.capturePage(rect)
  if (image.isEmpty()) return null
  const still = image.getSize().width > STILL_WIDTH ? image.resize({ width: STILL_WIDTH, quality: 'good' }) : image
  return `data:image/jpeg;base64,${still.toJPEG(STILL_QUALITY).toString('base64')}`
}
