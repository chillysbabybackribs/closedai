import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import type { ChatAttachment, ChatSnapshot, ChatThreadContent } from '../../shared/chat.js'
import { DEFAULT_APP_SETTINGS } from '../app-settings-store.js'
import type { ChatSurface } from '../chat-hub.js'
import { ChatStore } from '../chat-store/chat-store.js'
import { ChatPeerManager } from './peer-manager.js'
import { chatRecord, harnessWith, MemorySettings } from './peer-manager-harness.js'

class Surface extends EventEmitter implements ChatSurface {
  stopped = false
  running = false
  constructor(private readonly modelId: string | null, private readonly cwd: string) { super() }
  snapshot(): ChatSnapshot {
    return {
      provider: 'codex', connection: { state: 'ready', message: 'ready' }, account: null,
      models: [], selectedModel: this.modelId, selectedReasoningEffort: null, cwd: this.cwd,
      threadId: null, threadName: null, activeTurnId: this.running ? 'turn' : null, pausedTurnId: null, contextUsage: null, planUsage: null,
      turnContext: null, items: []
    }
  }
  async start(): Promise<void> {}
  async refreshPlanUsage(): Promise<void> {}
  stop(): void { this.stopped = true }
  async send(_text: string, _attachments: ChatAttachment[]): Promise<void> {}
  async interrupt(): Promise<void> {}
  async selectModel(_modelId: string): Promise<void> {}
  async selectReasoningEffort(_effort: string): Promise<void> {}
  async listThreads(): Promise<[]> { return [] }
  async readThread(threadId: string): Promise<ChatThreadContent> { return { threadId, threadName: null, items: [] } }
  async newThread(): Promise<void> {}
  async continueInNewThread(): Promise<void> {}
  async openThread(_threadId: string): Promise<void> {}
  async archiveThread(_threadId: string): Promise<void> {}
  async compactConversation(): Promise<void> {}
  async beginLogin(): Promise<string | null> { return null }
}

test('directory navigation retains running chats and opens them in their original directory', async (t) => {
  const settings = new MemorySettings({
    ...DEFAULT_APP_SETTINGS,
    chatOpenIds: ['pane-a'],
    chatSelectedPaneId: 'pane-a'
  })
  const store = ChatStore.inMemory([chatRecord('pane-a', 'gpt')])
  let selection = { cwd: '/workspace', projectPath: '/workspace' as string | null }
  const saved = new Map<string, { openIds: string[]; selectedPaneId: string | null }>()
  const surfaces: Surface[] = []
  const manager = new ChatPeerManager(
    settings,
    store,
    (_settings, record) => {
      assert.equal(_settings.get().chatWorkspacePath, record.cwd)
      const surface = new Surface(record.modelId, record.cwd)
      surfaces.push(surface)
      return surface
    },
    undefined,
    {
      current: () => selection,
      select: async (projectPath, preference) => {
        const current = settings.get()
        saved.set(selection.projectPath ?? 'no-project', {
          openIds: current.chatOpenIds,
          selectedPaneId: current.chatSelectedPaneId
        })
        selection = { cwd: projectPath ?? '/home/tester', projectPath }
        const destination = saved.get(projectPath ?? 'no-project')
        await settings.set({
          chatOpenIds: destination?.openIds ?? [],
          chatSelectedPaneId: destination?.selectedPaneId ?? null,
          chatThreadId: null,
          chatClaudeSessionId: null,
          chatAntigravityConversationId: null,
          chatModelId: preference.modelId,
          chatReasoningEffort: preference.reasoningEffort
        })
      }
    }
  )
  t.after(() => manager.stop())
  surfaces[0]!.running = true
  surfaces[0]!.emit('event', { type: 'turn', turnId: 'turn' })

  await manager.selectProject('/projects/new')

  assert.equal(surfaces[0]!.stopped, false)
  assert.deepEqual(manager.snapshot().workspace, { cwd: '/projects/new', projectPath: '/projects/new' })
  assert.equal(manager.snapshot().chats.length, 2)
  assert.equal(manager.snapshot().chats.find((row) => row.paneId === 'pane-a')?.running, true)
  assert.notEqual(manager.snapshot().selectedPaneId, 'pane-a')
  assert.equal(settings.get().chatOpenIds.length, 1)
  assert.equal(store.require(manager.snapshot().selectedPaneId).cwd, '/projects/new')

  const destination = manager.snapshot().selectedPaneId
  surfaces[1]!.running = true
  surfaces[1]!.emit('event', { type: 'turn', turnId: 'other-turn' })
  await manager.openChat('pane-a')
  assert.equal(manager.snapshot().selectedPaneId, 'pane-a')
  assert.equal(manager.snapshot().selected.cwd, '/workspace')
  assert.deepEqual(settings.get().chatOpenIds, ['pane-a'])
  assert.equal(manager.snapshot().chats.length, 2)
  assert.equal(manager.snapshot().chats.every((row) => row.running), true)
  assert.equal(surfaces.length, 2, 'navigation reuses both runtimes')
  await manager.openChat(destination)
  assert.equal(manager.snapshot().selected.cwd, '/projects/new')
  assert.equal(manager.snapshot().selectedPaneId, destination)
  assert.equal(surfaces.every((surface) => !surface.stopped), true)
})

test('archiving a detached foreign chat uses its own provider surface and preserves focus', async (t) => {
  const foreign = chatRecord('foreign', 'gpt', {
    cwd: '/other', projectPath: '/other', threadId: 'old-thread', codexThreadId: 'old-thread', preview: 'Saved'
  })
  const { manager, surfaces, store } = harnessWith([chatRecord('local', 'gpt'), foreign], 'local', undefined, ['local'])
  t.after(() => manager.stop())
  await manager.archiveChat('foreign')
  assert.equal(surfaces[0]!.calls.some((call) => call.startsWith('archive:')), false)
  assert.ok(surfaces[1]!.calls.includes('archive:old-thread'))
  assert.ok(surfaces[1]!.calls.includes('stop'))
  assert.equal(manager.snapshot().selectedPaneId, 'local')
  assert.equal(store.require('foreign').archived, true)
})
