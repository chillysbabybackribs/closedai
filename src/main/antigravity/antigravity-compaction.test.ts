import assert from 'node:assert/strict'
import test from 'node:test'
import { AntigravitySession } from './antigravity-session.ts'

test('compact drops the conversation id and seeds the next turn once', async () => {
  const session = new AntigravitySession({
    cwd: '/w',
    binary: () => 'agy',
    spawnArgs: () => ['--print='],
    servers: () => [],
    displayScreenshot: () => null,
    takeCallId: () => null,
    apply: () => {},
    onTurn: () => {},
    onConversationId: () => {},
    onTurnEnd: () => {}
  })
  await session.adopt('conv-1')
  await session.compact('summary text')
  assert.equal(session.conversationId, null)
  assert.equal(session.takePendingSeed(), 'summary text')
  assert.equal(session.takePendingSeed(), null)
})

test('reset clears a pending compaction seed', async () => {
  const session = new AntigravitySession({
    cwd: '/w',
    binary: () => 'agy',
    spawnArgs: () => ['--print='],
    servers: () => [],
    displayScreenshot: () => null,
    takeCallId: () => null,
    apply: () => {},
    onTurn: () => {},
    onConversationId: () => {},
    onTurnEnd: () => {}
  })
  await session.compact('summary text')
  await session.reset()
  assert.equal(session.pendingSeed, null)
})
