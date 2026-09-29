import type { DesktopWallpaper } from '../../shared/desktop-wallpaper.js'
import { accentColor, meanLuminance } from './backdrop-tone.js'

/* The wallpaper is prepared once per activation: a copy sized to the screen for the window
   gaps, and a small heavily blurred copy that tiles and chrome paint as their glass. Blurring
   once here instead of a live backdrop-filter keeps divider drags and tile animations free,
   since the only thing behind the tiles is this still image. */

export type PreparedBackdrop = {
  name: string
  image: string
  blurred: string
  luminance: number
  /** The wallpaper's vivid hue for Send and focus; null keeps the theme accent. */
  accent: string | null
  /** Luminance of the bands behind the title bar and the dock, which tint each rail. */
  topLuminance: number
  bottomLuminance: number
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
    return { name: wallpaper.name, image, blurred, ...sampleTone(bitmap) }
  } finally {
    bitmap.close()
  }
}

const THUMBNAIL_WIDTH = 480

/** A small JPEG of an uploaded image for its picker tile. Decoding it here also proves the file is an image before main stores it. */
export async function wallpaperThumbnail(file: Blob): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file)
  try {
    const blob = await encodeBlob(bitmap, Math.min(THUMBNAIL_WIDTH, bitmap.width), 0, 0.82)
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}

export function releaseBackdrop(backdrop: PreparedBackdrop): void {
  URL.revokeObjectURL(backdrop.image)
  URL.revokeObjectURL(backdrop.blurred)
}

async function encode(bitmap: ImageBitmap, width: number, blur: number, quality: number): Promise<string> {
  return URL.createObjectURL(await encodeBlob(bitmap, width, blur, quality))
}

async function encodeBlob(bitmap: ImageBitmap, width: number, blur: number, quality: number): Promise<Blob> {
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
  return canvas.convertToBlob({ type: 'image/jpeg', quality })
}

function sampleTone(bitmap: ImageBitmap): Pick<PreparedBackdrop, 'luminance' | 'accent' | 'topLuminance' | 'bottomLuminance'> {
  const canvas = new OffscreenCanvas(32, 18)
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(bitmap, 0, 0, 32, 18)
  const pixels = context.getImageData(0, 0, 32, 18).data
  // The title bar and the dock each cover about the outer 5% of a screen-shaped window.
  const band = Math.max(1, Math.round(bitmap.height * 0.05))
  const bandLuminance = (sy: number): number => {
    const strip = new OffscreenCanvas(64, 4)
    const stripContext = strip.getContext('2d', { willReadFrequently: true })!
    stripContext.drawImage(bitmap, 0, sy, bitmap.width, band, 0, 0, 64, 4)
    return meanLuminance(stripContext.getImageData(0, 0, 64, 4).data)
  }
  return {
    luminance: meanLuminance(pixels),
    accent: accentColor(pixels),
    topLuminance: bandLuminance(0),
    bottomLuminance: bandLuminance(bitmap.height - band)
  }
}
