import assert from 'node:assert/strict'
import test from 'node:test'
import { AntigravitySession } from './antigravity-session.js'
import type { TranscriptOp, TurnEnd } from './antigravity-stream.js'

// A persistent CLI fixture reports exactly which prompt reached it, including its sequence.
const fixture = `
const lines = require('node:readline').createInterface({ input: process.stdin });
const conversation = process.argv[1] || 'new-conversation';
let count = 0;
lines.on('line', (line) => {
  const content = JSON.parse(line).message.content;
  count++;
  console.log(JSON.stringify({ event: 'init', conversation_id: conversation, init: {} }));
  if (content === 'HOLD') return;
  console.log(JSON.stringify({ event: 'step_update', step_update: {
    conversation_id: conversation, step_index: 1, state: 'DONE', step_type: 'agent_response',
    text_delta: count + ':' + content,
    usage: { input_tokens: 1500, cache_read_tokens: 500 }
  } }));
  console.log(JSON.stringify({ event: 'result', result: {
    status: 'SUCCESS', conversation_id: conversation, response: count + ':' + content
  } }));
});
`

function pending<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function harness() {
  const ops: TranscriptOp[] = []
  const ends: TurnEnd[] = []
  const tokenUsages: Array<{ inputTokens: number; cacheReadTokens?: number; cacheAnomaly: boolean }> = []
  let completed = pending<TurnEnd>()
  const initialized = pending<string>()
  const session = new AntigravitySession({
    cwd: process.cwd(), binary: () => process.execPath,
    spawnArgs: (resume) => ['-e', fixture, resume ?? 'new-conversation'],
    servers: () => [], displayScreenshot: () => null, takeCallId: () => null,
    apply: (op) => ops.push(op), onTurn: () => {},
    onConversationId: (id) => initialized.resolve(id),
    onTurnEnd: (_id, end) => { ends.push(end); completed.resolve(end) },
    onTokenUsage: (usage) => tokenUsages.push(usage)
  })
  return { session, ops, ends, tokenUsages, initialized: initialized.promise,
    send(content: string) {
      completed = pending<TurnEnd>()
      session.send(content)
      return completed.promise
    }
  }
}

test('cold, warm, and resumed processes receive the user prompt without an initialization turn', { timeout: 5000 }, async () => {
  const h = harness()
  try {
    assert.equal((await h.send('first')).status, 'completed')
    assert.match(JSON.stringify(h.ops), /1:first/)
    assert.equal(h.session.conversationId, 'new-conversation')
    assert.deepEqual(h.tokenUsages[0], { inputTokens: 1500, cacheReadTokens: 500, cacheAnomaly: false })
    assert.equal((await h.send('second')).status, 'completed')
    assert.match(JSON.stringify(h.ops), /2:second/)
    await h.session.retire()
    assert.equal((await h.send('resumed')).status, 'completed')
    assert.match(JSON.stringify(h.ops), /1:resumed/)
    assert.equal(h.session.conversationId, 'new-conversation')
    assert.equal(h.ends.length, 3)
  } finally {
    await h.session.retire()
  }
})

test('interrupt kills a running process and retains the conversation for the next send', { timeout: 5000 }, async () => {
  const h = harness()
  try {
    const ending = h.send('HOLD')
    await h.initialized
    await h.session.interrupt()
    assert.equal((await ending).status, 'interrupted')
    assert.equal(h.session.live, false)
    assert.equal(h.session.conversationId, 'new-conversation')
    assert.equal((await h.send('after interrupt')).status, 'completed')
    assert.match(JSON.stringify(h.ops), /1:after interrupt/)
    assert.equal(h.ends.length, 2)
  } finally {
    await h.session.retire()
  }
})
