import assert from 'node:assert/strict'
import test from 'node:test'
import type { NativeImage } from 'electron'

import { compositeBitmapBgra } from './app-window-composite-bitmap.ts'

function solid(w: number, h: number, b: number, g: number, r: number, a = 255): Buffer {
  const buf = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    buf[o] = b
    buf[o + 1] = g
    buf[o + 2] = r
    buf[o + 3] = a
  }
  return buf
}

function fakeImage(width: number, height: number, bitmap: Buffer): NativeImage {
  return {
    getSize: () => ({ width, height }),
    toBitmap: () => bitmap,
    isEmpty: () => false,
    resize: () => fakeImage(width, height, bitmap)
  } as unknown as NativeImage
}

test('compositeBitmapBgra overwrites the destination region with the overlay', () => {
  const base = solid(4, 4, 0, 0, 0)
  const overlay = fakeImage(2, 2, solid(2, 2, 10, 20, 30))
  const out = compositeBitmapBgra(base, 4, 4, overlay, { x: 1, y: 1, width: 2, height: 2 })
  assert.equal(out[(1 * 4 + 1) * 4], 10)
  assert.equal(out[(1 * 4 + 1) * 4 + 1], 20)
  assert.equal(out[(2 * 4 + 2) * 4 + 2], 30)
  assert.equal(out[0], 0, 'outside the patch stays base')
})
