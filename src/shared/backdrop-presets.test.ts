import assert from 'node:assert/strict'
import test from 'node:test'
import { backdropPresetId, normalizeWorkspaceBackdrop } from './backdrop-presets.js'

test('workspace backdrop presets normalize from stored strings', () => {
  assert.equal(normalizeWorkspaceBackdrop('desktop'), 'desktop')
  assert.equal(normalizeWorkspaceBackdrop('preset:ocean'), 'preset:ocean')
  assert.equal(normalizeWorkspaceBackdrop('preset:missing'), 'off')
  assert.equal(normalizeWorkspaceBackdrop('off'), 'off')
})

test('backdropPresetId extracts bundled preset ids', () => {
  assert.equal(backdropPresetId('preset:ember'), 'ember')
  assert.equal(backdropPresetId('desktop'), null)
})
