import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chatRecord } from '../chat-peers/peer-manager-harness.js'
import { ChatPaneLexicalIndex } from './chat-pane-lexical-index.js'

const settings = { chatMemoryIndexEnabled: true, chatMemoryIndexMaxCharsPerChat: 10_000 }

test('disk-backed ChatPaneLexicalIndex persists JSON and serves scope chat via FTS', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-pane-index-'))
  const record = chatRecord('pane-disk', null, { codexThreadId: 't', threadId: 't' })
  const index = new ChatPaneLexicalIndex(dir, () => settings)
  await index.load()
  index.upsert(record, [{ type: 'user', id: 'u1', turnId: 't', text: 'Remember layout tokens for sidebar' }], {
    rotationEpoch: 0,
    partial: false
  })
  await index.flush()

  const reopened = new ChatPaneLexicalIndex(dir, () => settings)
  await reopened.load()
  const hit = reopened.searchPane('pane-disk', { scope: 'chat', query: 'layout sidebar' }).hits[0]
  assert.match(hit?.snippet ?? '', /layout/i)
})
