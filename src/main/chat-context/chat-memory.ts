import type { ChatHistoryRequest, ChatHistoryResult, ChatMemoryCheckpoint, ChatRecallRequest, ChatRecallResult } from '../../shared/chat-memory.js'
import type { ChatRecord } from '../../shared/chat-store.js'
import type { ChatSurface } from '../chat-hub.js'
import { validateMemoryState } from './memory-checkpoint.js'
import { recallTranscript } from './memory-recall.js'

export type MemoryCaller = { paneId?: string | null; threadId: string | null; turnId: string | null; signal?: AbortSignal }
type MemorySurface = Pick<ChatSurface, 'snapshot' | 'readThread'>

/** The chat records memory reads and writes; the store, or a stand-in in tests. */
export type MemoryRecords = {
  get(id: string): ChatRecord | undefined
  ids(): string[]
  update(id: string, patch: { checkpoint: ChatMemoryCheckpoint }): ChatRecord
}

/** One app-owned checkpoint per chat; transcripts stay in their existing provider stores. */
export class ChatMemory {
  constructor(private readonly records: MemoryRecords, private readonly surface: (paneId: string) => MemorySurface | null) {}

  /** Discovery uses existing records only: no transcript loading, model calls, or new index. */
  history(caller: MemoryCaller, request: ChatHistoryRequest): ChatHistoryResult {
    const { pane } = this.resolve(caller)
    let records = this.historyRecords(pane)
    if (request.cwd !== undefined) records = records.filter((record) => record.cwd === request.cwd)
    if (request.beforeChatId) {
      const index = records.findIndex((record) => record.id === request.beforeChatId)
      if (index < 0) throw new Error('History cursor is unavailable')
      records = records.slice(index + 1)
    }
    const query = request.query?.trim().toLowerCase()
    if (query) records = records.filter((record) => {
      const notes = record.checkpoint?.threadId === record.threadId ? record.checkpoint.state : null
      return [record.title, record.preview, record.cwd, notes ? JSON.stringify(notes) : ''].some((text) => text?.toLowerCase().includes(query))
    })
    const limit = Math.max(1, Math.min(8, Math.floor(request.limit ?? 5)))
    const result: ChatHistoryResult = { chats: [], nextBeforeChatId: null, trust: 'historical-data' }
    for (const record of records.slice(0, limit)) {
      const entry = {
        chatId: record.id, threadId: record.threadId!, title: (record.title ?? 'Untitled chat').slice(0, 120),
        preview: record.preview.slice(0, 240), cwd: record.cwd, lastActivityAt: historyActivity(record)
      }
      if (JSON.stringify({ ...result, chats: [...result.chats, entry], nextBeforeChatId: record.id }).length > 16_000) {
        if (!result.chats.length) throw new Error('History entry metadata exceeds the output budget')
        break
      }
      result.chats.push(entry)
    }
    result.nextBeforeChatId = records.length > result.chats.length ? result.chats.at(-1)!.chatId : null
    return result
  }

  async save(caller: MemoryCaller, expectedRevision: number, state: unknown): Promise<ChatMemoryCheckpoint> {
    const { pane, surface } = this.resolve(caller)
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER
      || caller.threadId!.length > 256) throw new Error('Invalid checkpoint revision or thread id')
    if (!caller.turnId || surface.snapshot({ limit: 0 }).activeTurnId !== caller.turnId) throw new Error('Checkpoint requires the caller’s active turn')
    const current = pane.checkpoint?.threadId === caller.threadId ? pane.checkpoint : null
    if (expectedRevision !== (current?.revision ?? 0)) throw new Error('Checkpoint revision changed; recall current memory before replacing it')
    const throughItemId = surface.snapshot({ limit: 1 }).items.at(-1)?.id
    if (!throughItemId || throughItemId.length > 256) throw new Error('No stable transcript boundary is available')
    const checkpoint: ChatMemoryCheckpoint = {
      version: 1, revision: (current?.revision ?? 0) + 1, threadId: caller.threadId!,
      throughItemId, createdAt: Date.now(), state: validateMemoryState(state)
    }
    // No await between scope/revision validation and the synchronous record update.
    this.records.update(pane.id, { checkpoint })
    if (this.resolve(caller).surface !== surface) throw new Error('Chat changed while saving memory')
    return checkpoint
  }

  async recall(caller: MemoryCaller, request: ChatRecallRequest): Promise<ChatRecallResult> {
    const { pane, surface } = this.resolve(caller)
    if (request.chatId && request.scope !== 'history') throw new Error('chat_id requires history scope')
    if (request.scope === 'current') {
      const snapshot = surface.snapshot()
      const checkpoint = pane.checkpoint?.threadId === caller.threadId ? pane.checkpoint : null
      return recallTranscript(snapshot.items, caller.threadId!, checkpoint, request, null)
    }
    if (request.scope === 'history') {
      const target = request.chatId
        ? this.historyRecords(pane).find((record) => record.id === request.chatId)
        : this.historyRecords(pane)[0]
      if (!target?.threadId) throw new Error('No matching conversation is available in history')
      const content = await this.read(target.id, target.threadId, surface, target.cwd)
      const resolved = this.resolve(caller)
      if (resolved.surface !== surface) throw new Error('Workspace changed while loading memory')
      const latest = this.historyRecords(resolved.pane).find((record) => record.id === target.id)
      if (latest?.threadId !== target.threadId) throw new Error('History chat changed while loading memory')
      return recallTranscript(content.items, target.threadId, latest.checkpoint, { ...request, chatId: target.id }, null)
    }
    if (request.scope !== 'source') throw new Error('Unknown recall scope')
    const source = pane.continuation
    if (!source?.sourceThreadId || !source.sourceThroughItemId) {
      throw new Error('This chat has no bounded continuation source; older continuations cannot be safely recalled')
    }
    const content = await this.read(source.sourcePaneId, source.sourceThreadId, surface)
    const resolved = this.resolve(caller)
    if (resolved.surface !== surface) throw new Error('Workspace changed while loading memory')
    const latest = resolved.pane.continuation
    if (latest?.sourceThreadId !== source.sourceThreadId || latest.sourceThroughItemId !== source.sourceThroughItemId) {
      throw new Error('Continuation changed while loading its source')
    }
    return recallTranscript(content.items, source.sourceThreadId, source.checkpoint ?? null, request, source.sourceThroughItemId)
  }

  private historyRecords(pane: ChatRecord): ChatRecord[] {
    return this.records.ids().map((id) => this.records.get(id))
      .filter((record): record is ChatRecord => !!record && record.id !== pane.id && !!record.threadId && !record.archived)
      .filter((record) => record.messageSentAt !== null || record.lastTurnEndedAt !== null || record.preview.trim() || record.continuation)
      .sort((a, b) => historyActivity(b) - historyActivity(a) || a.id.localeCompare(b.id))
  }

  private async read(paneId: string | null | undefined, threadId: string, surface: MemorySurface, cwd?: string) {
    const target = paneId ? this.surface(paneId) : null
    const live = target?.snapshot({ limit: 0 }).threadId === threadId ? target.snapshot() : null
    const content = live?.items.length ? live : await surface.readThread(threadId, cwd)
    if (content.threadId !== threadId) throw new Error('Provider returned a different history thread')
    return content
  }

  private resolve(caller: MemoryCaller) {
    if (caller.signal?.aborted) throw new Error('Memory request was cancelled')
    const pane = caller.paneId ? this.records.get(caller.paneId) : undefined
    const surface = pane ? this.surface(pane.id) : null
    if (!pane || !surface || !caller.threadId || surface.snapshot({ limit: 0 }).threadId !== caller.threadId) {
      throw new Error('Memory is available only to the calling pane’s current thread')
    }
    return { pane, surface }
  }
}

/** User submissions outrank background completion, pinning, and incidental record updates. */
function historyActivity(record: ChatRecord): number {
  return record.messageSentAt ?? record.lastTurnEndedAt ?? record.createdAt
}
