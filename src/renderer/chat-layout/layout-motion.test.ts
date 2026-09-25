import assert from 'node:assert/strict'
import test from 'node:test'
import { appearedRect, glideFrom, inlineRect } from './layout-motion.ts'

test('glideFrom inverts a move and resize to the previous box', () => {
  const glide = glideFrom({ x: 0, y: 0, width: 400, height: 300 }, { x: 200, y: 0, width: 200, height: 600 })
  assert.deepEqual(glide, { dx: -200, dy: 0, sx: 2, sy: 0.5 })
  // Played from that transform, the new box first appears exactly where the old one was.
  assert.deepEqual(appearedRect({ x: 200, y: 0, width: 200, height: 600 }, { a: 2, d: 0.5, e: -200, f: 0 }),
    { x: 0, y: 0, width: 400, height: 300 })
})

test('glideFrom ignores sub-pixel jitter and collapsed boxes', () => {
  assert.equal(glideFrom({ x: 10, y: 10, width: 300, height: 200 }, { x: 10.3, y: 9.8, width: 300.4, height: 200 }), null)
  assert.equal(glideFrom({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 300, height: 200 }), null)
  assert.equal(glideFrom({ x: 0, y: 0, width: 300, height: 200 }, { x: 0, y: 0, width: 0, height: 200 }), null)
})

test('a retargeted glide starts from where the tile currently appears', () => {
  // Halfway through a glide toward (100, 0, 200x200), the tile appears at (50, 0, 300x200).
  const appeared = appearedRect({ x: 100, y: 0, width: 200, height: 200 }, { a: 1.5, d: 1, e: -50, f: 0 })
  assert.deepEqual(appeared, { x: 50, y: 0, width: 300, height: 200 })
  assert.deepEqual(glideFrom(appeared, { x: 0, y: 0, width: 100, height: 200 }), { dx: 50, dy: 0, sx: 3, sy: 1 })
})

test('inlineRect reads the inline geometry and rejects incomplete styles', () => {
  const element = (style: Partial<CSSStyleDeclaration>) => ({ style }) as HTMLElement
  assert.deepEqual(inlineRect(element({ left: '12px', top: '0px', width: '480.5px', height: '300px' })),
    { x: 12, y: 0, width: 480.5, height: 300 })
  assert.equal(inlineRect(element({ left: '', top: '0px', width: '480px', height: '300px' })), null)
})
