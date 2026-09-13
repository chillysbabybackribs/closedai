import { chatRecordThreadId, type ChatRecord } from '../../shared/chat-store.js'
import { chatProviderOfId, isChatProvider } from '../../shared/chat-providers.js'
import type { ChatPeerRecord } from '../../shared/types.js'
import { normalizeContinuation } from '../app-settings-store.js'
import { normalizeMemoryCheckpoint } from '../chat-context/memory-checkpoint.js'
import { MAX_SESSION_ROTATIONS, type ChatSessionRotation } from '../../shared/session-rotation.js'

// Shape checks for records read back from disk, and the one-way translation from the pane
// records that settings used to hold. Both keep the pane id as the chat id: the drawer's
// completion marks and the per-pane checkpoints were keyed by it, and a rename would have
// orphaned every one of them.

export function normalizeChatRecord(candidate: unknown): ChatRecord | null {
  if (!candidate || typeof candidate !== 'object') return null
  const record = candidate as Record<string, unknown>
  const id = optionalString(record.id)
  const cwd = optionalString(record.cwd)
  if (!id || !cwd) return null
  const modelId = optionalString(record.modelId)
  const provider = isChatProvider(record.provider) ? record.provider : chatProviderOfId(modelId)
  const ids = {
    codexThreadId: optionalString(record.codexThreadId),
    claudeSessionId: optionalString(record.claudeSessionId),
    antigravityConversationId: optionalString(record.antigravityConversationId),
    cursorSessionId: optionalString(record.cursorSessionId)
  }
  const createdAt = positiveTime(record.createdAt) ?? positiveTime(record.updatedAt) ?? Date.now()
  return {
    id,
    cwd,
    projectPath: optionalString(record.projectPath),
    provider,
    modelId,
    reasoningEffort: optionalString(record.reasoningEffort),
    ...ids,
    threadId: chatRecordThreadId(provider, ids),
    title: optionalString(record.title),
    preview: typeof record.preview === 'string' ? record.preview : '',
    createdAt,
    updatedAt: positiveTime(record.updatedAt) ?? createdAt,
    lastTurnEndedAt: positiveTime(record.lastTurnEndedAt),
    // Before this marker existed, a completed turn or non-empty preview is the durable evidence
    // that a provider thread contains a user conversation. A thread id alone may be startup noise.
    messageSentAt: positiveTime(record.messageSentAt)
      ?? positiveTime(record.lastTurnEndedAt)
      ?? (typeof record.preview === 'string' && record.preview.length > 0 ? positiveTime(record.updatedAt) ?? createdAt : null),
    archived: record.archived === true,
    pinnedAt: positiveTime(record.pinnedAt),
    continuation: normalizeContinuation(record.continuation),
    checkpoint: record.checkpoint === undefined ? null : normalizeMemoryCheckpoint(record.checkpoint),
    parentChatId: optionalString(record.parentChatId),
    sessionRotations: normalizeSessionRotations(record.sessionRotations)
  }
}

/** A pane record from settings as the chat record it becomes; `paneId` is kept as the id. */
export function chatRecordFromPeer(peer: ChatPeerRecord, cwd: string, projectPath: string | null): ChatRecord {
  const ids = {
    codexThreadId: peer.codexThreadId,
    claudeSessionId: peer.claudeSessionId,
    antigravityConversationId: peer.antigravityConversationId ?? null,
    cursorSessionId: peer.cursorSessionId ?? null
  }
  const updatedAt = positiveTime(peer.updatedAt) ?? Date.now()
  return {
    id: peer.paneId,
    cwd,
    projectPath,
    provider: peer.provider,
    modelId: peer.modelId,
    reasoningEffort: peer.reasoningEffort,
    ...ids,
    threadId: chatRecordThreadId(peer.provider, ids),
    title: peer.title ?? null,
    preview: '',
    createdAt: updatedAt,
    updatedAt,
    lastTurnEndedAt: peer.threadId ? updatedAt : null,
    messageSentAt: peer.threadId ? updatedAt : null,
    archived: false,
    pinnedAt: null,
    continuation: peer.continuation ?? null,
    checkpoint: peer.checkpoint ?? null,
    parentChatId: null,
    sessionRotations: []
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function positiveTime(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null
}

function normalizeSessionRotations(value: unknown): ChatSessionRotation[] {
  if (!Array.isArray(value)) return []
  const rotations: ChatSessionRotation[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue
    const record = candidate as Record<string, unknown>
    if (!Number.isInteger(record.epoch) || Number(record.epoch) < 1) continue
    if (typeof record.at !== 'number' || !Number.isFinite(record.at) || record.at <= 0) continue
    rotations.push({
      epoch: Number(record.epoch),
      sourceThroughItemId: optionalString(record.sourceThroughItemId),
      providerThreadId: optionalString(record.providerThreadId),
      at: Math.floor(record.at)
    })
  }
  return rotations.slice(-MAX_SESSION_ROTATIONS)
}
