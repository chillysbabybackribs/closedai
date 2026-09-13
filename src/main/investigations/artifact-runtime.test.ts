import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { ChatStore } from '../chat-store/chat-store.js'
import type { ChatPeerManager } from '../chat-peers/peer-manager.js'
import type { ToolContext } from '../tools/tool.js'
import { createArtifactRuntime } from './artifact-runtime.js'

test('runtime resolves archive scope from the stable chat record and checks the active caller', async () => {
  const root = await mkdtemp(join(tmpdir(), 'closedai-artifact-owner-'))
  const chats = ChatStore.inMemory()
  chats.create({ id: 'chat-a', cwd: '/project-a', projectPath: '/project-a', provider: 'codex', modelId: null, reasoningEffort: null })
  let threadId = 'thread-one'
  let activeTurnId = 'turn-one'
  const runtime = createArtifactRuntime({
    root, chats, workerUrl: new URL('./artifact-worker.ts', import.meta.url),
    peers: () => ({ paneSnapshot: () => ({ threadId, activeTurnId }) }) as unknown as ChatPeerManager
  })
  const context: ToolContext = { paneId: 'chat-a', threadId, turnId: activeTurnId, callId: 'c1', signal: new AbortController().signal }
  try {
    const collected = await runtime.service.retainProtocol(context, {
      key: 'first', label: 'first', method: 'Runtime.evaluate', params: { expression: '1' }, tabId: 'tab'
    }, async () => ({ result: 1 })) as { artifact: { id: string } }
    threadId = 'replacement-provider-thread'
    activeTurnId = 'next-turn'
    await assert.rejects(runtime.service.access(context, 'list', {}), /current active turn/)
    const current = { ...context, threadId, turnId: activeTurnId }
    const list = await runtime.service.access(current, 'list', {}) as { artifacts: Array<{ id: string }> }
    assert.equal(list.artifacts[0].id, collected.artifact.id)
    await assert.rejects(runtime.service.access({ ...current, paneId: 'unknown' }, 'list', {}), /current active turn/)
    chats.archive('chat-a')
    await assert.rejects(runtime.service.access(current, 'list', {}), /current active turn/)
  } finally { await runtime.store.close(); await rm(root, { recursive: true, force: true }) }
})
