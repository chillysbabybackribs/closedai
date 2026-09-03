import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTurnContextReport, estimateTokens } from './turn-inspector.js'

test('turn inspector reports message, safe attachment delivery, and exact app additions', () => {
  const report = buildTurnContextReport({
    provider: 'claude',
    model: 'claude:opus',
    threadId: 'claude:session-1',
    prompt: 'Review this file',
    attachments: [
      { id: 'file-1', kind: 'file', name: 'notes.txt', path: '/tmp/notes.txt' },
      { id: 'image-1', kind: 'image', name: 'pasted.png', url: 'data:image/png;base64,secret' }
    ],
    additionalContext: {
      'closedai.browser.active-tab': { kind: 'untrusted', value: '{"title":"Docs"}' }
    },
    createdAt: 42
  })

  assert.equal(report.createdAt, 42)
  assert.equal(report.message.characters, 16)
  assert.equal(report.attachments[0]?.path, '/tmp/notes.txt')
  assert.match(report.attachments[0]?.delivery ?? '', /Read tool/)
  assert.equal(report.attachments[1]?.path, undefined)
  assert.doesNotMatch(JSON.stringify(report), /base64,secret/)
  assert.deepEqual(report.additions[0], {
    name: 'closedai.browser.active-tab',
    kind: 'untrusted',
    value: '{"title":"Docs"}',
    characters: 16,
    estimatedTokens: 4
  })
  assert.match(report.retainedHistory, /native SDK session/)
})

test('token estimate is bounded and rounds partial tokens up', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens('abcde'), 2)
})
