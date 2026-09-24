import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatTranscriptItem } from '../../shared/chat.js'
import { measureRotationPressure, pressureTrigger } from './rotation-pressure.ts'

const user = (id: string): ChatTranscriptItem => ({ type: 'user', id, turnId: 't1', text: 'hi' })
const tool = (id: string, output = 'x'): ChatTranscriptItem => ({
  type: 'tool',
  id,
  turnId: 't1',
  label: 'run',
  detail: '',
  status: 'done',
  output
})

test('pressure counts tools only after the latest user message', () => {
  const items = [user('u1'), tool('a', 'aa'), user('u2'), tool('b', 'bbb'), tool('c', 'c')]
  assert.deepEqual(measureRotationPressure(items), {
    itemCount: 5,
    toolCallsSinceUser: 2,
    toolOutputCharsSinceUser: 4
  })
})

test('pressure triggers respect zero thresholds as off', () => {
  const pressure = { itemCount: 200, toolCallsSinceUser: 50, toolOutputCharsSinceUser: 1_000_000 }
  assert.equal(pressureTrigger(pressure, { atItems: 0, atToolCallsSinceUser: 0, atToolOutputChars: 0 }), null)
  assert.equal(pressureTrigger(pressure, { atItems: 100, atToolCallsSinceUser: 0, atToolOutputChars: 0 }), 'items')
  assert.equal(pressureTrigger(pressure, { atItems: 0, atToolCallsSinceUser: 24, atToolOutputChars: 0 }), 'toolCalls')
  assert.equal(pressureTrigger(pressure, { atItems: 0, atToolCallsSinceUser: 0, atToolOutputChars: 280_000 }), 'toolOutputChars')
})
