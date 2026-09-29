import assert from 'node:assert/strict'
import test from 'node:test'
import { backdropPresetId, backdropUploadId, isImageBackdrop, normalizeWorkspaceBackdrop } from './backdrop-presets.js'

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

test('uploads normalize only with a UUID id, so a stored key can never name a path', () => {
  const id = '0b7f6d7e-3c1a-4c4e-9f7a-2d8e5b1c9a10'
  assert.equal(normalizeWorkspaceBackdrop(`upload:${id}`), `upload:${id}`)
  assert.equal(normalizeWorkspaceBackdrop('upload:../../etc/passwd'), 'off')
  assert.equal(backdropUploadId(`upload:${id}`), id)
  assert.equal(backdropUploadId('preset:ember'), null)
})

test('only bundled and uploaded images count as image backdrops', () => {
  assert.equal(isImageBackdrop('preset:dusk'), true)
  assert.equal(isImageBackdrop('upload:0b7f6d7e-3c1a-4c4e-9f7a-2d8e5b1c9a10'), true)
  assert.equal(isImageBackdrop('desktop'), false)
  assert.equal(isImageBackdrop('off'), false)
})
