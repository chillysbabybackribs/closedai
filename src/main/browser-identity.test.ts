import assert from 'node:assert/strict'
import test from 'node:test'
import { browserUserAgentFallback } from './browser-identity.ts'

test('fallback removes Electron and app tokens while preserving Chrome', () => {
  assert.equal(
    browserUserAgentFallback(
      'Mozilla/5.0 Chrome/150.0.0.0 CodeApp/0.1.0 Electron/43.1.1 Safari/537.36',
      'CodeApp'
    ),
    'Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36'
  )
})
