import assert from 'node:assert/strict'
import test from 'node:test'
import { boundsEqual, transformGlides } from './native-view-bounds.js'

const rect = { x: 20, y: 40, width: 800, height: 600, visible: true }

test('native bounds equality includes modal occlusion state', () => {
  assert.equal(boundsEqual(rect, { ...rect, occluded: true }), false)
  assert.equal(boundsEqual({ ...rect, occluded: true }, { ...rect, occluded: true }), true)
})

test('transform glides on the host or an ancestor defer the read; endless or finished ones do not', () => {
  const animation = (keyframes: Keyframe[], endTime = 190, playState: AnimationPlayState = 'running') => ({
    playState,
    effect: { getKeyframes: () => keyframes, getComputedTiming: () => ({ endTime }) }
  }) as unknown as Animation
  const glide = animation([{ transform: 'translate(-40px, 0)' }, { transform: 'none' }])
  const tile = { parentElement: null, getAnimations: () => [glide, animation([{ opacity: 0.8 }])] }
  const host = { parentElement: tile, getAnimations: () => [animation([{ transform: 'rotate(1turn)' }], Infinity)] }
  assert.deepEqual(transformGlides(host as unknown as Element), [glide])
  // The tile sits deeper than the observed ancestors; its glide still defers the read.
  type Node = { parentElement: unknown; getAnimations: () => Animation[] }
  let deep: Node = { parentElement: tile, getAnimations: () => [] }
  for (let depth = 0; depth < 10; depth += 1) deep = { parentElement: deep, getAnimations: () => [] }
  assert.deepEqual(transformGlides(deep as unknown as Element), [glide])
  const landed = { parentElement: null, getAnimations: () => [animation([{ transform: 'none' }], 190, 'finished')] }
  assert.deepEqual(transformGlides(landed as unknown as Element), [])
})
