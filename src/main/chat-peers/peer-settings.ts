import type { AppSettings, ChatPeerRecord } from '../../shared/types.js'
import { chatProviderOfId, prefixChatId } from '../../shared/chat-providers.js'
import type { AppSettingsAccess } from '../app-settings-store.js'

// One pane's view of the flat settings: the pane's record projected onto the legacy
// single-chat fields each provider reads (its own thread id, the model, the effort).

export class PeerSettings implements AppSettingsAccess {
  constructor(
    private readonly root: AppSettingsAccess,
    readonly paneId: string
  ) {}

  get(): AppSettings {
    const settings = this.root.get()
    const peer = this.peer(settings)
    return {
      ...settings,
      chatThreadId: peer.codexThreadId,
      chatClaudeSessionId: peer.claudeSessionId,
      chatAntigravityConversationId: peer.antigravityConversationId ?? null,
      chatCursorSessionId: peer.cursorSessionId ?? null,
      chatModelId: peer.modelId,
      chatReasoningEffort: peer.reasoningEffort,
      chatContinuation: peer.continuation ?? null
    }
  }

  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = this.root.get()
    const peer = this.peer(current)
    const modelId = patch.chatModelId === undefined ? peer.modelId : patch.chatModelId
    // A cleared model keeps the pane on its provider; a set one names the provider.
    const provider = modelId === null ? peer.provider : chatProviderOfId(modelId)
    const codexThreadId = patch.chatThreadId === undefined ? peer.codexThreadId : patch.chatThreadId
    const claudeSessionId = patch.chatClaudeSessionId === undefined ? peer.claudeSessionId : patch.chatClaudeSessionId
    const antigravityConversationId = patch.chatAntigravityConversationId === undefined
      ? peer.antigravityConversationId ?? null
      : patch.chatAntigravityConversationId
    const cursorSessionId = patch.chatCursorSessionId === undefined
      ? peer.cursorSessionId ?? null
      : patch.chatCursorSessionId
    const updated: ChatPeerRecord = {
      ...peer,
      provider,
      modelId,
      reasoningEffort: patch.chatReasoningEffort === undefined ? peer.reasoningEffort : patch.chatReasoningEffort,
      codexThreadId,
      claudeSessionId,
      antigravityConversationId,
      cursorSessionId,
      threadId: peerThreadId(provider, { codexThreadId, claudeSessionId, antigravityConversationId, cursorSessionId }),
      continuation: patch.chatContinuation === undefined ? peer.continuation ?? null : patch.chatContinuation
    }
    await this.root.set({
      chatPeers: current.chatPeers.map((entry) => entry.paneId === this.paneId ? updated : entry),
      ...(current.chatSelectedPaneId === this.paneId ? {
        chatThreadId: updated.codexThreadId,
        chatClaudeSessionId: updated.claudeSessionId,
        chatAntigravityConversationId: updated.antigravityConversationId ?? null,
        chatCursorSessionId: updated.cursorSessionId ?? null,
        chatModelId: updated.modelId,
        chatReasoningEffort: updated.reasoningEffort,
        chatContinuation: updated.continuation ?? null
      } : {})
    })
    return this.get()
  }

  private peer(settings: AppSettings): ChatPeerRecord {
    const peer = settings.chatPeers.find((entry) => entry.paneId === this.paneId)
    if (!peer) throw new Error(`Unknown chat pane: ${this.paneId}`)
    return peer
  }
}

/** The pane's displayed thread id: the active provider's thread, in that provider's id form. */
export function peerThreadId(
  provider: ChatPeerRecord['provider'],
  ids: {
    codexThreadId: string | null
    claudeSessionId: string | null
    antigravityConversationId: string | null
    cursorSessionId: string | null
  }
): string | null {
  if (provider === 'claude') return ids.claudeSessionId ? prefixChatId(provider, ids.claudeSessionId) : null
  if (provider === 'antigravity') {
    return ids.antigravityConversationId ? prefixChatId(provider, ids.antigravityConversationId) : null
  }
  if (provider === 'cursor') return ids.cursorSessionId ? prefixChatId(provider, ids.cursorSessionId) : null
  return ids.codexThreadId
}
