import assert from 'node:assert/strict'
import test from 'node:test'

import { applyTranscriptOp, handleProviderTurnEnd, type TranscriptOp } from './chat-transcript-ops.js'
import { IdleProcessGuard } from './idle-process-guard.js'

test('applyTranscriptOp routes item, delta, and notice operations', () => {
  const events: string[] = []
  const transcript = {
    upsert: () => events.push('upsert'),
    appendDelta: () => events.push('delta')
  }
  const ops: TranscriptOp[] = [
    { type: 'item', item: { id: 'a', type: 'assistant', text: 'hi' } as never },
    { type: 'delta', itemId: 'a', field: 'text', delta: '!' },
    { type: 'notice', text: 'warn', tone: 'info' }
  ]
  for (const op of ops) applyTranscriptOp(transcript, (text) => events.push(`notice:${text}`), op)
  assert.deepEqual(events, ['upsert', 'delta', 'notice:warn'])
})

test('handleProviderTurnEnd reports pause and failure notices', () => {
  const notices: Array<[string, 'info' | 'error']> = []
  let paused: string | null = 'unset'
  handleProviderTurnEnd('turn-1', { status: 'interrupted' }, {
    addNotice: (text, tone) => notices.push([text, tone]),
    setPaused: (turnId) => { paused = turnId }
  })
  handleProviderTurnEnd('turn-2', { status: 'failed', error: 'boom' }, {
    addNotice: (text, tone) => notices.push([text, tone]),
    setPaused: () => {}
  })
  assert.deepEqual(notices, [['Turn paused', 'info'], ['boom', 'error']])
  assert.equal(paused, 'turn-1')
})

test('IdleProcessGuard fires once after the idle window', () => {
  let fired = 0
  const guard = new IdleProcessGuard(() => { fired += 1 }, 5)
  guard.schedule(true)
  assert.equal(fired, 0)
  guard.clear()
  guard.schedule(true)
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      try {
        assert.equal(fired, 1)
        resolve()
      } catch (error) {
        reject(error)
      }
    }, 20)
  })
})
