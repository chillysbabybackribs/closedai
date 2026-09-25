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
