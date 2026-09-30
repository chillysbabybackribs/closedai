import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatTranscriptItem } from '../../shared/chat.js'
import { DEFAULT_APP_SETTINGS } from '../app-settings-store.ts'
import { createSessionRotator } from './session-rotator-factory.ts'
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


test('rotated history cannot re-trigger pressure, including a boundary inside the last turn', () => {
  const old = [user('u1'), ...Array.from({ length: 110 }, (_, i) => tool(`old-${i}`, 'large output'))]
  const items = [...old, tool('new', 'ok')]
  assert.deepEqual(measureRotationPressure(items, 'old-109'), {
    itemCount: 1, toolCallsSinceUser: 1, toolOutputCharsSinceUser: 2
  })
  assert.equal(pressureTrigger(measureRotationPressure(items, 'old-109'), {
    atItems: 100, atToolCallsSinceUser: 24, atToolOutputChars: 100
  }), null)
  assert.equal(measureRotationPressure(items, 'new').itemCount, 0)
  assert.equal(measureRotationPressure(items, 'missing').itemCount, items.length)
})


test('the provider rotator uses the saved boundary when evaluating a retained transcript', () => {
  const items = [user('u'), ...Array.from({ length: 110 }, (_, i) => tool(`t${i}`))]
  const saved = { ...DEFAULT_APP_SETTINGS, chatSessionRotations: [
    { epoch: 1, sourceThroughItemId: 't109', providerThreadId: 'old', at: 1 }
  ] }
  const rotator = createSessionRotator({
    settings: { get: () => saved, set: async () => saved }, transcriptItems: () => items,
    threadId: () => 'new', turnActive: () => false, rotate: async () => {}
  })
  rotator.turnFinished()
  assert.equal(rotator.scheduledForIdle, false)
  items.push(user('next'), ...Array.from({ length: 100 }, (_, i) => tool(`new${i}`)))
  rotator.turnFinished()
  assert.equal(rotator.scheduledForIdle, true)
  rotator.reset()
})
