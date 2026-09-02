import assert from 'node:assert/strict'
import test from 'node:test'

import { openFailureMessage } from './drawer-format.js'

test('a writer-lock conflict names the cause instead of reading as a fault', () => {
  // Verbatim shape of the rejection Electron surfaces for chat:openThread, from a session where the
  // ChatGPT desktop app held the same thread in the shared ~/.codex store.
  const error = new Error(
    "Error invoking remote method 'chat:openThread': AppServerRpcError: " +
    'thread 01a06384-a430-7981-9520-9e34780daf5d already has an active writer'
  )
  assert.equal(openFailureMessage(error), 'Open in another app')
})

test('the app-server phrasing of the same conflict maps to the same notice', () => {
  assert.equal(
    openFailureMessage(new Error('thread-store conflict: thread abc already has an active writer')),
    'Open in another app'
  )
})

test('a missing thread is distinguished from a locked one', () => {
  assert.equal(openFailureMessage(new Error('thread not found')), 'Thread unavailable')
})

test('an unrecognised failure still yields a row-width notice', () => {
  assert.equal(openFailureMessage(new Error('socket hang up')), 'Could not open')
})

test('non-Error rejections do not throw', () => {
  assert.equal(openFailureMessage('already has an active writer'), 'Open in another app')
  assert.equal(openFailureMessage(undefined), 'Could not open')
})
