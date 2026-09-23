import assert from 'node:assert/strict'
import test from 'node:test'
import { runPromptSweep } from './prompt-sweep.js'

test('prompt sweep entry is exported for harness scripts', () => {
  assert.equal(typeof runPromptSweep, 'function')
})
