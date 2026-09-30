import assert from 'node:assert/strict'
import test from 'node:test'

import { hashLocalProfilePassword, verifyLocalProfilePassword } from './local-profile-password.js'

test('hashLocalProfilePassword verifies the same password and rejects others', async () => {
  const stored = await hashLocalProfilePassword('correct horse')
  assert.match(stored, /^pbkdf2-sha256:/)
  assert.equal(await verifyLocalProfilePassword('correct horse', stored), true)
  assert.equal(await verifyLocalProfilePassword('wrong', stored), false)
})

test('verifyLocalProfilePassword rejects malformed stored hashes', async () => {
  assert.equal(await verifyLocalProfilePassword('x', 'not-a-hash'), false)
  assert.equal(await verifyLocalProfilePassword('x', 'pbkdf2-sha256:0:!!:!!'), false)
})
