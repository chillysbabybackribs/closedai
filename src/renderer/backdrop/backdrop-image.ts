import type { DesktopWallpaper } from '../../shared/desktop-wallpaper.js'
import { meanLuminance } from './backdrop-tone.js'

/* The wallpaper is prepared once per activation: a copy sized to the screen for the window
   gaps, and a small heavily blurred copy that tiles and chrome paint as their glass. Blurring
   once here instead of a live backdrop-filter keeps divider drags and tile animations free,
   since the only thing behind the tiles is this still image. */

export type PreparedBackdrop = {
  name: string
  image: string
  blurred: string
  luminance: number
}

const BLURRED_WIDTH = 480
const BLUR_RADIUS = 14

export async function prepareBackdrop(wallpaper: DesktopWallpaper, screenWidth: number): Promise<PreparedBackdrop> {
  const bitmap = await createImageBitmap(new Blob([wallpaper.bytes as BlobPart], { type: wallpaper.mimeType }))
  try {
    const sharpWidth = Math.min(bitmap.width, Math.max(1280, Math.round(screenWidth)))
    const [image, blurred] = await Promise.all([
      encode(bitmap, sharpWidth, 0, 0.9),
      encode(bitmap, BLURRED_WIDTH, BLUR_RADIUS, 0.85)
    ])
    return { name: wallpaper.name, image, blurred, luminance: sampleLuminance(bitmap) }
  } finally {
    bitmap.close()
  }
}

export function releaseBackdrop(backdrop: PreparedBackdrop): void {
  URL.revokeObjectURL(backdrop.image)
  URL.revokeObjectURL(backdrop.blurred)
}

async function encode(bitmap: ImageBitmap, width: number, blur: number, quality: number): Promise<string> {
  const height = Math.max(1, Math.round(bitmap.height * (width / bitmap.width)))
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')!
  context.imageSmoothingQuality = 'high'
  if (blur > 0) {
    // Overdraw past every edge so the blur never pulls in the canvas's transparent border.
    // Saturation keeps the frosted colour clean under the dark tint instead of greying to mud.
    context.filter = `blur(${blur}px) saturate(1.6)`
    context.drawImage(bitmap, -blur * 2, -blur * 2, width + blur * 4, height + blur * 4)
  } else {
    context.drawImage(bitmap, 0, 0, width, height)
  }
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/jpeg', quality }))
}

function sampleLuminance(bitmap: ImageBitmap): number {
  const canvas = new OffscreenCanvas(32, 18)
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(bitmap, 0, 0, 32, 18)
  return meanLuminance(context.getImageData(0, 0, 32, 18).data)
}
