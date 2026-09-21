import assert from 'node:assert/strict'
import test from 'node:test'
import { errorMessage } from './error-message.ts'

test('strips the Electron remote-method prefix and a leading error class name', () => {
  assert.equal(errorMessage(new Error("Error invoking remote method 'chat:open': Error: Missing thread")), 'Missing thread')
  assert.equal(errorMessage(new Error('TypeError: bad input')), 'bad input')
  assert.equal(errorMessage("Error invoking remote method 'x': permission denied"), 'permission denied')
})

test('keeps ordinary messages and stringifies non-Error values', () => {
  assert.equal(errorMessage(new Error('  disk full  ')), 'disk full')
  assert.equal(errorMessage(42), '42')
})

test('falls back when nothing readable remains', () => {
  assert.equal(errorMessage(new Error('')), 'Something went wrong')
  assert.equal(errorMessage('Error: '), 'Something went wrong')
  assert.equal(errorMessage(new Error(''), 'Could not save'), 'Could not save')
})

test('bounds long messages to 140 characters with an ellipsis', () => {
  const long = errorMessage('x'.repeat(300))
  assert.equal(long.length, 140)
  assert.ok(long.endsWith('…'))
  assert.equal(errorMessage('y'.repeat(140)), 'y'.repeat(140))
})
