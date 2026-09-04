import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import type { ChatAttachment, ChatSnapshot, ChatThreadContent } from '../../shared/chat.js'
import { DEFAULT_APP_SETTINGS } from '../app-settings-store.js'
import type { ChatSurface } from '../chat-hub.js'
import { ChatStore } from '../chat-store/chat-store.js'
import { ChatPeerManager } from './peer-manager.js'
import { chatRecord, MemorySettings } from './peer-manager-harness.js'

class Surface extends EventEmitter implements ChatSurface {
  stopped = false
  constructor(private readonly modelId: string | null) { super() }
  snapshot(): ChatSnapshot {
    return {
      provider: 'codex', connection: { state: 'ready', message: 'ready' }, account: null,
      models: [], selectedModel: this.modelId, selectedReasoningEffort: null, cwd: '/workspace',
      threadId: null, threadName: null, activeTurnId: null, pausedTurnId: null, contextUsage: null, planUsage: null,
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

test('choosing a project replaces workspace panes and publishes its selected directory', async () => {
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
      const surface = new Surface(record.modelId)
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

  await manager.selectProject('/projects/new')

  assert.equal(surfaces[0]!.stopped, true)
  assert.deepEqual(manager.snapshot().workspace, { cwd: '/projects/new', projectPath: '/projects/new' })
  assert.equal(manager.snapshot().chats.length, 1)
  assert.notEqual(manager.snapshot().selectedPaneId, 'pane-a')
  assert.equal(settings.get().chatOpenIds.length, 1)
  assert.equal(store.require(manager.snapshot().selectedPaneId).cwd, '/projects/new')

  await manager.selectProject('/workspace')
  assert.equal(manager.snapshot().selectedPaneId, 'pane-a')
  assert.deepEqual(manager.snapshot().chats.map((chat) => chat.paneId), ['pane-a'])
})
