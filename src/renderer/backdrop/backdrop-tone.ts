/* How strongly the app darkens a wallpaper so text stays legible over any photo. A bright
   image gets a heavier dim in the gaps and a denser glass tint on the tiles; a dark one keeps
   more of its colour. Pure, so the curve is testable without a canvas. */

export type BackdropTone = {
  /** Black overlay alpha over the sharp wallpaper (window gaps, title bar). */
  dim: number
  /** Dark tint alpha over the blurred wallpaper behind a chat transcript: a hint of colour, not a see-through pane. */
  glass: number
}

/** Mean relative luminance (0 dark … 1 white) of RGBA pixel data. */
export function meanLuminance(rgba: ArrayLike<number>): number {
  let total = 0
  let count = 0
  for (let index = 0; index + 3 < rgba.length; index += 4) {
    total += 0.2126 * linear(rgba[index]!) + 0.7152 * linear(rgba[index + 1]!) + 0.0722 * linear(rgba[index + 2]!)
    count += 1
  }
  return count ? total / count : 0
}

export function backdropTone(luminance: number): BackdropTone {
  const light = Math.min(1, Math.max(0, luminance))
  return {
    dim: round(clamp(0.18 + 0.7 * light, 0.18, 0.62)),
    glass: round(clamp(0.84 + 0.2 * light, 0.84, 0.94))
  }
}

/** Linear light a rail settles at, whatever the wallpaper behind it: the dock's depth over the Fuji foreground. */
const RAIL_TARGET = 0.04

/**
 * Dark tint alpha for a rail (title bar, dock) from the luminance of the wallpaper band behind it.
 * Each rail is tinted to land at the same darkness, so a bright sky above and a dark foreground
 * below still give a matching pair. The floor keeps a dark band from reading as no bar at all;
 * the ceiling keeps some of the photo's colour in a bright one.
 */
export function railTint(bandLuminance: number): number {
  const light = Math.max(bandLuminance, 0.001)
  return round(clamp(1 - RAIL_TARGET / light, 0.5, 0.9))
}

const HUE_BINS = 24

/**
 * The wallpaper's most vivid hue as a colour that reads on dark glass (Send, the focus ring):
 * the Fuji sunset gives its orange. Pixels are weighted by chroma squared, so a small bright
 * patch outweighs a large washed-out sky. Lightness is fixed so any photo yields a legible
 * accent. Null when the image has no real colour, and the theme accent stays.
 */
export function accentColor(rgba: ArrayLike<number>): string | null {
  const weights = new Array<number>(HUE_BINS).fill(0)
  const saturation = new Array<number>(HUE_BINS).fill(0)
  for (let index = 0; index + 3 < rgba.length; index += 4) {
    const [hue, chroma, sat] = hueOf(rgba[index]! / 255, rgba[index + 1]! / 255, rgba[index + 2]! / 255)
    if (chroma < 0.12) continue
    const bin = Math.floor(hue / (360 / HUE_BINS)) % HUE_BINS
    weights[bin]! += chroma * chroma
    saturation[bin]! += sat * chroma * chroma
  }
  let best = 0
  for (let bin = 1; bin < HUE_BINS; bin += 1) if (weights[bin]! > weights[best]!) best = bin
  if (weights[best]! < 0.02) return null
  // The chosen bin's neighbours pull the hue toward where the colour actually sits.
  const prev = (best + HUE_BINS - 1) % HUE_BINS
  const next = (best + 1) % HUE_BINS
  const total = weights[prev]! + weights[best]! + weights[next]!
  const width = 360 / HUE_BINS
  const hue = ((best + 0.5) * width + (weights[next]! - weights[prev]!) / total * width + 360) % 360
  const sat = clamp(saturation[best]! / weights[best]!, 0.68, 0.88)
  return `hsl(${Math.round(hue)} ${Math.round(sat * 100)}% 64%)`
}

function hueOf(red: number, green: number, blue: number): [number, number, number] {
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const chroma = max - min
  if (chroma === 0) return [0, 0, 0]
  const hue = max === red ? ((green - blue) / chroma + 6) % 6 : max === green ? (blue - red) / chroma + 2 : (red - green) / chroma + 4
  const lightness = (max + min) / 2
  return [hue * 60, chroma, chroma / (1 - Math.abs(2 * lightness - 1))]
}

function linear(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
