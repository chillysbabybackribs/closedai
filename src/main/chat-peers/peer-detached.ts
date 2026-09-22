import { chatProviderOfId } from '../../shared/chat-providers.js'
import type { ChatPaneId } from '../../shared/chat-peers.js'
import type { ChatStore } from '../chat-store/chat-store.js'
import type { PeerLifecycle } from './peer-lifecycle.js'

export function isPinnedChat(store: ChatStore, paneId: ChatPaneId): boolean {
  return store.get(paneId)?.pinnedAt !== null
}

export async function createDetachedPeer(options: {
  assertAvailable: () => void
  selectedPaneId: ChatPaneId
  store: ChatStore
  lifecycle: PeerLifecycle
  emitWorkspace: () => void
  persistOpenChats: () => Promise<void>
  wakeLater: (paneId: ChatPaneId, reason: string) => void
}): Promise<ChatPaneId> {
  options.assertAvailable()
  const current = options.lifecycle.require(options.selectedPaneId).surface.snapshot({ limit: 0 })
  const selection = options.store.require(options.selectedPaneId)
  const record = options.store.create({
    cwd: selection.cwd,
    projectPath: selection.projectPath,
    provider: chatProviderOfId(current.selectedModel),
    modelId: current.selectedModel,
    reasoningEffort: current.selectedReasoningEffort,
    title: 'Agent workspace',
    titleSource: 'manual',
    pinnedAt: Date.now(),
    agentWorkspace: true
  })
  options.lifecycle.attach(record)
  options.emitWorkspace()
  await options.persistOpenChats()
  options.wakeLater(record.id, 'start the agent workspace chat')
  return record.id
}
