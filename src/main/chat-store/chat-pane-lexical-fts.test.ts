import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHAT_PANE_LEXICAL_INDEX_VERSION } from '../../shared/chat-index.js'
import { buildFtsMatchQuery, ChatPaneLexicalFts } from './chat-pane-lexical-fts.js'

test('buildFtsMatchQuery ANDs quoted terms', () => {
  assert.equal(buildFtsMatchQuery('alpha beta'), '"alpha" AND "beta"')
})

test('ChatPaneLexicalFts ranks matching lines and survives reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-pane-fts-'))
  const record = {
    version: CHAT_PANE_LEXICAL_INDEX_VERSION,
    chatId: 'pane-1',
    cwd: '/project',
    title: 'Test',
    lastActivityAt: 10,
    rotationEpoch: 2,
    partial: false,
    updatedAt: 20,
    lines: [
      { itemId: 'u1', role: 'user' as const, text: 'Keep purple accent tokens' },
      { itemId: 'u2', role: 'user' as const, text: 'Unrelated green theme' }
    ]
  }
  const fts = new ChatPaneLexicalFts(dir)
  fts.open()
  fts.replaceChat(record)
  const match = buildFtsMatchQuery('purple accent')!
  const hits = fts.search('pane-1', match, 5)
  assert.equal(hits[0]?.itemId, 'u1')
  fts.close()

  const reopened = new ChatPaneLexicalFts(dir)
  reopened.open()
  assert.equal(reopened.search('pane-1', match, 5)[0]?.itemId, 'u1')
  assert.equal(reopened.meta('pane-1')?.rotationEpoch, 2)
  reopened.removeChat('pane-1')
  assert.equal(reopened.search('pane-1', match, 5).length, 0)
})
