import assert from 'node:assert/strict'
import test from 'node:test'
import { providerSupportsContextShrink } from './context-shrink-eligibility.js'

test('seamless rotation exposes shrink for Claude, Codex, and Cursor', () => {
  assert.equal(providerSupportsContextShrink('claude', true), true)
  assert.equal(providerSupportsContextShrink('codex', true), true)
  assert.equal(providerSupportsContextShrink('cursor', true), true)
  assert.equal(providerSupportsContextShrink('antigravity', true), true)
})

test('legacy Codex compaction remains available when seamless rotation is off', () => {
  assert.equal(providerSupportsContextShrink('codex', false), true)
  assert.equal(providerSupportsContextShrink('claude', false), false)
})
