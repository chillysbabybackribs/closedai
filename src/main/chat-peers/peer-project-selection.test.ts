import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import type { ChatAttachment, ChatSnapshot, ChatThreadContent } from '../../shared/chat.js'
import type { AppSettings } from '../../shared/types.js'
import { DEFAULT_APP_SETTINGS, type AppSettingsAccess } from '../app-settings-store.js'
import type { ChatSurface } from '../chat-hub.js'
import { ChatPeerManager } from './peer-manager.js'

class MemorySettings implements AppSettingsAccess {
  constructor(private value: AppSettings) {}
  get(): AppSettings { return structuredClone(this.value) }
  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.value = { ...this.value, ...structuredClone(patch) }
    return this.get()
  }
}

class Surface extends EventEmitter implements ChatSurface {
  stopped = false
  constructor(private readonly modelId: string | null) { super() }
  snapshot(): ChatSnapshot {
    return {
      provider: 'codex', connection: { state: 'ready', message: 'ready' }, account: null,
      models: [], selectedModel: this.modelId, selectedReasoningEffort: null, cwd: '/workspace',
      threadId: null, threadName: null, activeTurnId: null, contextUsage: null, planUsage: null,
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
  async beginLogin(): Promise<string | null> { return null }
}

test('choosing a project replaces workspace panes and publishes its selected directory', async () => {
  const settings = new MemorySettings({
    ...DEFAULT_APP_SETTINGS,
    chatPeers: [{
      paneId: 'pane-a', provider: 'codex', threadId: null, codexThreadId: null, claudeSessionId: null,
      modelId: 'gpt', reasoningEffort: null
    }],
    chatSelectedPaneId: 'pane-a'
  })
  let selection = { cwd: '/workspace', projectPath: '/workspace' as string | null }
  const saved = new Map<string, { peers: AppSettings['chatPeers']; selectedPaneId: string | null }>()
  const surfaces: Surface[] = []
  const manager = new ChatPeerManager(
    settings,
    (_settings, modelId) => {
      const surface = new Surface(modelId)
      surfaces.push(surface)
      return surface
    },
    undefined,
    {
      current: () => selection,
      select: async (projectPath, preference) => {
        const current = settings.get()
        saved.set(selection.projectPath ?? 'no-project', {
          peers: current.chatPeers,
          selectedPaneId: current.chatSelectedPaneId
        })
        selection = { cwd: projectPath ?? '/home/tester', projectPath }
        const destination = saved.get(projectPath ?? 'no-project')
        await settings.set({
          chatPeers: destination?.peers ?? [],
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
  assert.equal(manager.snapshot().peers.length, 1)
  assert.notEqual(manager.snapshot().selectedPaneId, 'pane-a')
  assert.equal(settings.get().chatPeers.length, 1)

  await manager.selectProject('/workspace')
  assert.equal(manager.snapshot().selectedPaneId, 'pane-a')
  assert.equal(manager.snapshot().peers[0]?.paneId, 'pane-a')
})
