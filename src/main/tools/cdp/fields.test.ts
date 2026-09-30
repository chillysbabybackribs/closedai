import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeCdpSessionId, sessionIdFrom } from './fields.js'

test('normalizeCdpSessionId treats empty strings as root-frame captures', () => {
  assert.equal(normalizeCdpSessionId(''), undefined)
  assert.equal(normalizeCdpSessionId(null), undefined)
  assert.equal(normalizeCdpSessionId(undefined), undefined)
  assert.equal(normalizeCdpSessionId('child-1'), 'child-1')
})

test('sessionIdFrom omits blank session_id arguments', () => {
  assert.equal(sessionIdFrom({ session_id: '' }), undefined)
  assert.equal(sessionIdFrom({ session_id: 'worker-1' }), 'worker-1')
})
