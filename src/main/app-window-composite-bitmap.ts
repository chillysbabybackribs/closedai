import type { NativeImage } from 'electron'

export function compositeBitmapBgra(
  base: Buffer,
  baseWidth: number,
  baseHeight: number,
  overlay: NativeImage,
  dest: { x: number; y: number; width: number; height: number }
): Buffer {
  let patch = overlay
  const patchSize = patch.getSize()
  if (patchSize.width !== dest.width || patchSize.height !== dest.height) {
    patch = patch.resize({ width: dest.width, height: dest.height, quality: 'best' })
  }
  const patchBuf = patch.toBitmap()
  const out = Buffer.from(base)
  for (let py = 0; py < dest.height; py++) {
    const by = dest.y + py
    if (by < 0 || by >= baseHeight) continue
    for (let px = 0; px < dest.width; px++) {
      const bx = dest.x + px
      if (bx < 0 || bx >= baseWidth) continue
      const pi = (py * dest.width + px) * 4
      const bi = (by * baseWidth + bx) * 4
      out[bi] = patchBuf[pi]!
      out[bi + 1] = patchBuf[pi + 1]!
      out[bi + 2] = patchBuf[pi + 2]!
      out[bi + 3] = patchBuf[pi + 3]!
    }
  }
  return out
}
