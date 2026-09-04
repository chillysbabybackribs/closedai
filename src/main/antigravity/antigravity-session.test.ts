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
  console.log(JSON.stringify({ event: 'result', result: {
    status: 'SUCCESS', conversation_id: conversation, response: count + ':' + content
  } }));
});
`

function harness() {
  const ops: TranscriptOp[] = []
  const ends: TurnEnd[] = []
  let completed = Promise.withResolvers<TurnEnd>()
  const initialized = Promise.withResolvers<string>()
  const session = new AntigravitySession({
    cwd: process.cwd(), binary: () => process.execPath,
    spawnArgs: (resume) => ['-e', fixture, resume ?? 'new-conversation'],
    servers: () => [], displayScreenshot: () => null, takeCallId: () => null,
    apply: (op) => ops.push(op), onTurn: () => {},
    onConversationId: (id) => initialized.resolve(id),
    onTurnEnd: (_id, end) => { ends.push(end); completed.resolve(end) }
  })
  return { session, ops, ends, initialized: initialized.promise,
    send(content: string) {
      completed = Promise.withResolvers<TurnEnd>()
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
