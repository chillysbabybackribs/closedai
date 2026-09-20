import type { ChatRecord } from '../../shared/chat-store.js'
import { chatRecordThreadId, type ChatProviderThreadIds } from '../../shared/chat-store.js'
import type { ChatMemoryCheckpoint } from '../../shared/chat-memory.js'
import type { ChatSessionRotation } from '../../shared/session-rotation.js'
import type { AppSettings, ChatPeerRecord } from '../../shared/types.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import type { ChatStore } from '../chat-store/chat-store.js'

// One pane's view of the flat settings: its chat record projected onto the legacy single-chat
// fields each provider reads (its own thread id, the model, the effort). Providers never learn
// about the store; they keep reading and writing `chatThreadId` and friends.

export class PeerSettings implements AppSettingsAccess {
  constructor(
    private readonly root: AppSettingsAccess,
    private readonly store: ChatStore,
    readonly paneId: string
  ) {}

  get(): AppSettings {
    const settings = this.root.get()
    const chat = this.store.require(this.paneId)
    return {
      ...settings,
      chatWorkspacePath: chat.cwd,
      chatProjectPath: chat.projectPath,
      chatThreadId: chat.codexThreadId,
      chatClaudeSessionId: chat.claudeSessionId,
      chatAntigravityConversationId: chat.antigravityConversationId,
      chatCursorSessionId: chat.cursorSessionId,
      chatModelId: chat.modelId,
      chatReasoningEffort: chat.reasoningEffort,
      chatContinuation: chat.continuation,
      chatSessionRotations: chat.sessionRotations
    }
  }

  checkpoint(): ChatMemoryCheckpoint | null {
    return this.store.get(this.paneId)?.checkpoint ?? null
  }

  sessionRotations(): ChatSessionRotation[] {
    return this.store.get(this.paneId)?.sessionRotations ?? []
  }

  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    const updated = this.store.update(this.paneId, {
      ...(patch.chatModelId !== undefined ? { modelId: patch.chatModelId } : {}),
      ...(patch.chatReasoningEffort !== undefined ? { reasoningEffort: patch.chatReasoningEffort } : {}),
      ...(patch.chatThreadId !== undefined ? { codexThreadId: patch.chatThreadId } : {}),
      ...(patch.chatClaudeSessionId !== undefined ? { claudeSessionId: patch.chatClaudeSessionId } : {}),
      ...(patch.chatAntigravityConversationId !== undefined ? { antigravityConversationId: patch.chatAntigravityConversationId } : {}),
      ...(patch.chatCursorSessionId !== undefined ? { cursorSessionId: patch.chatCursorSessionId } : {}),
      ...(patch.chatContinuation !== undefined ? { continuation: patch.chatContinuation } : {}),
      ...(patch.chatSessionRotations !== undefined ? { sessionRotations: patch.chatSessionRotations } : {})
    })
    // Settings other than the pane projection (compaction thresholds, disabled tools) pass through.
    const { chatThreadId: _t, chatClaudeSessionId: _c, chatAntigravityConversationId: _a, chatCursorSessionId: _u,
      chatModelId: _m, chatReasoningEffort: _e, chatContinuation: _h, chatSessionRotations: _r, ...rest } = patch
    const current = this.root.get()
    // The flat chat* fields mirror whichever pane is selected, so a relaunch that falls back to
    // them reads the model and threads of the pane the user was in.
    const mirror = current.chatSelectedPaneId === this.paneId ? selectedMirror(updated) : {}
    if (Object.keys(rest).length > 0 || Object.keys(mirror).length > 0) await this.root.set({ ...rest, ...mirror })
    return this.get()
  }
}

/** The flat single-chat fields as the selected chat's record fills them. */
export function selectedMirror(chat: ChatRecord | null): Partial<AppSettings> {
  return {
    chatThreadId: chat?.codexThreadId ?? null,
    chatClaudeSessionId: chat?.claudeSessionId ?? null,
    chatAntigravityConversationId: chat?.antigravityConversationId ?? null,
    chatCursorSessionId: chat?.cursorSessionId ?? null,
    chatModelId: chat?.modelId ?? null,
    chatReasoningEffort: chat?.reasoningEffort ?? null,
    chatContinuation: chat?.continuation ?? null
  }
}

/** The pane's displayed thread id: the active provider's thread, in that provider's id form. */
export function peerThreadId(provider: ChatPeerRecord['provider'], ids: ChatProviderThreadIds): string | null {
  return chatRecordThreadId(provider, ids)
}
