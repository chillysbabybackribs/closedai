import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { tabOutlinePath } from './tab-outline.ts'

describe('tabOutlinePath', () => {
  const box = { width: 1000, height: 44, tabLeft: 400, tabWidth: 200 }
  const up = { strip: 32, radius: 7, fillet: 5, opens: 'up' } as const
  const down = { ...up, opens: 'down' } as const
  const ys = (path: string): number[] => [...path.matchAll(/(?:[ML]|A [\d.]+ [\d.]+ 0 0 [01]) [\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]))

  it('drops the tab below the strip on a top rail, the rising tab mirrored top to bottom', () => {
    const rising = tabOutlinePath(box, up)
    const dropping = tabOutlinePath(box, down)
    assert.ok(dropping.startsWith('M 0 32 '), 'the line runs along the strip bottom')
    assert.deepEqual(ys(dropping), ys(rising).map((y) => box.height - y))
    assert.ok(Math.max(...ys(dropping)) === box.height, 'the tab reaches the full height')
  })

  it('flips the arcs so the corners still round outward', () => {
    const sweeps = (path: string): string[] => [...path.matchAll(/A [\d.]+ [\d.]+ 0 0 ([01])/g)].map((m) => m[1])
    assert.deepEqual(sweeps(tabOutlinePath(box, down)), sweeps(tabOutlinePath(box, up)).map((s) => (s === '1' ? '0' : '1')))
  })

  it('closes a dropping tab round the window top edge for the clip', () => {
    assert.match(tabOutlinePath(box, down, 0, true), / H 1000 V 0 H 0 Z$/)
  })
})
