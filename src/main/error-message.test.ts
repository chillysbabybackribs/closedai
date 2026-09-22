import assert from 'node:assert/strict'
import test from 'node:test'

import { messageOf } from './error-message.js'

test('messageOf prefers Error.message', () => {
  assert.equal(messageOf(new Error('boom')), 'boom')
})

test('messageOf stringifies plain objects', () => {
  assert.equal(messageOf({ code: 'E1' }), '{"code":"E1"}')
})
