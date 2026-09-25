import assert from 'node:assert/strict'
import test from 'node:test'
import { readStill, saveStill } from './space-stills.ts'

const memory = (): Pick<Storage, 'getItem' | 'setItem'> & { values: Map<string, string> } => {
  const values = new Map<string, string>()
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } }
}

test('a space\'s still is kept under its id and read back', () => {
  const storage = memory()
  saveStill(storage, 'space:1', 'data:image/jpeg;base64,AAAA')
  assert.equal(readStill(storage, 'space:1'), 'data:image/jpeg;base64,AAAA')
  assert.equal(readStill(storage, 'space:2'), null)
})

test('anything but an image is ignored, and a full store is not an error', () => {
  const storage = memory()
  storage.values.set('closedai.spaces.still:x', 'javascript:alert(1)')
  assert.equal(readStill(storage, 'x'), null)
  const full = { setItem: () => { throw new Error('QuotaExceededError') } }
  assert.doesNotThrow(() => saveStill(full, 'x', 'data:image/jpeg;base64,AAAA'))
})
