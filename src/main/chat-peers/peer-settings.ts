import type { AppSettings, ChatPeerRecord } from '../../shared/types.js'
import type { AppSettingsAccess } from '../app-settings-store.js'

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
      chatModelId: peer.modelId,
      chatReasoningEffort: peer.reasoningEffort
    }
  }

  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = this.root.get()
    const peer = this.peer(current)
    const modelId = patch.chatModelId === undefined ? peer.modelId : patch.chatModelId
    const provider = modelId?.startsWith('claude:') ? 'claude' : peer.provider === 'claude' && modelId === null
      ? 'claude'
      : 'codex'
    const updated: ChatPeerRecord = {
      ...peer,
      provider,
      modelId,
      reasoningEffort: patch.chatReasoningEffort === undefined ? peer.reasoningEffort : patch.chatReasoningEffort,
      codexThreadId: patch.chatThreadId === undefined ? peer.codexThreadId : patch.chatThreadId,
      claudeSessionId: patch.chatClaudeSessionId === undefined ? peer.claudeSessionId : patch.chatClaudeSessionId,
      threadId: provider === 'claude'
        ? sessionThreadId(patch.chatClaudeSessionId === undefined ? peer.claudeSessionId : patch.chatClaudeSessionId)
        : patch.chatThreadId === undefined ? peer.codexThreadId : patch.chatThreadId
    }
    await this.root.set({
      chatPeers: current.chatPeers.map((entry) => entry.paneId === this.paneId ? updated : entry),
      ...(current.chatSelectedPaneId === this.paneId ? {
        chatThreadId: updated.codexThreadId,
        chatClaudeSessionId: updated.claudeSessionId,
        chatModelId: updated.modelId,
        chatReasoningEffort: updated.reasoningEffort
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

function sessionThreadId(sessionId: string | null): string | null {
  return sessionId ? `claude:${sessionId}` : null
}
