import { EventEmitter } from 'node:events'
import type { ChatThreadSummary } from '../../shared/chat.js'
import { chatRecordThreadId, type ChatRecord, type ChatRecordPatch, type ChatRecordSeed, type ChatStoreFile } from '../../shared/chat-store.js'
import { bareChatId, chatProviderOfId } from '../../shared/chat-providers.js'
import { writeAtomic } from '../atomic-write.js'
import { readStoreFile } from '../store-recovery.js'
import { normalizeChatRecord } from './chat-record.js'

// Every chat the app has shown, in one file. Reads are synchronous from memory because the
// drawer, the peer manager, and provider settings ask on every event; writes coalesce into one
// atomic rewrite shortly after the last change, and `flush` drains that before quit. Records
// are never deleted by lifecycle: archiving hides one, and only a chat that never accepted a
// user message or continuation is removed outright.

const WRITE_DELAY_MS = 150

export const CHAT_STORE_MAX_PREVIEW = 240

/** `checkpointIds` names the changed records whose active checkpoint may now differ. */
export type ChatStoreChange = { ids: string[]; checkpointIds: string[] }

export class ChatStore extends EventEmitter {
  private readonly chats = new Map<string, ChatRecord>()
  private writeTimer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()
  private dirty = false

  private constructor(private readonly filePath: string | null) {
    super()
  }

  static async open(filePath: string): Promise<ChatStore> {
    const store = new ChatStore(filePath)
    // A damaged file is set aside before the store starts empty; otherwise the first debounced
    // write would replace every chat record the user has with none.
    const parsed = await readStoreFile(filePath, '[chat-store]', (text) => JSON.parse(text) as Partial<ChatStoreFile>)
    for (const candidate of Array.isArray(parsed?.chats) ? parsed.chats : []) {
      const record = normalizeChatRecord(candidate)
      if (record && !store.chats.has(record.id)) store.chats.set(record.id, record)
    }
    return store
  }

  /** A store that never touches disk, for tests and headless runs. */
  static inMemory(records: ChatRecord[] = []): ChatStore {
    const store = new ChatStore(null)
    for (const record of records) store.chats.set(record.id, record)
    return store
  }

  /** Live (unarchived) chats of one working directory, most recently updated first. */
  list(cwd: string, projectPath?: string | null): ChatRecord[] {
    return [...this.chats.values()]
      .filter((record) => !record.archived && record.cwd === cwd && (projectPath === undefined || record.projectPath === projectPath))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
  }

  /** Ids of every live chat, in any workspace; archived ones are left out so their side files go. */
  ids(): string[] {
    return [...this.chats.keys()].filter((id) => !this.chats.get(id)!.archived)
  }

  get(id: string): ChatRecord | undefined {
    return this.chats.get(id)
  }

  require(id: string): ChatRecord {
    const record = this.chats.get(id)
    if (!record) throw new Error(`Unknown chat: ${id}`)
    return record
  }

  has(id: string): boolean {
    return this.chats.has(id)
  }

  findByThreadId(threadId: string): ChatRecord | undefined {
    for (const record of this.chats.values()) {
      if (record.threadId === threadId) return record
    }
    return undefined
  }

  create(seed: ChatRecordSeed): ChatRecord {
    const now = Date.now()
    const ids = {
      codexThreadId: seed.codexThreadId ?? null,
      claudeSessionId: seed.claudeSessionId ?? null,
      antigravityConversationId: seed.antigravityConversationId ?? null,
      cursorSessionId: seed.cursorSessionId ?? null
    }
    const record: ChatRecord = {
      id: seed.id ?? crypto.randomUUID(),
      cwd: seed.cwd,
      projectPath: seed.projectPath,
      provider: seed.provider,
      modelId: seed.modelId,
      reasoningEffort: seed.reasoningEffort,
      ...ids,
      threadId: chatRecordThreadId(seed.provider, ids),
      title: seed.title ?? null,
      titleSource: seed.titleSource ?? null,
      titleGenerationAttempted: seed.titleGenerationAttempted ?? false,
      preview: seed.preview ?? '',
      createdAt: seed.createdAt ?? now,
      updatedAt: seed.updatedAt ?? now,
      lastTurnEndedAt: seed.lastTurnEndedAt ?? null,
      messageSentAt: seed.messageSentAt ?? null,
      archived: seed.archived ?? false,
      pinnedAt: seed.pinnedAt ?? null,
      continuation: seed.continuation ?? null,
      checkpoint: seed.checkpoint ?? null,
      parentChatId: seed.parentChatId ?? null,
      coordinatorGroup: seed.coordinatorGroup ?? null,
      sessionRotations: seed.sessionRotations ?? []
    }
    if (this.chats.has(record.id)) throw new Error(`Chat already exists: ${record.id}`)
    this.chats.set(record.id, record)
    this.changed([record.id])
    return record
  }

  /**
   * Merge a patch. A model id names the provider; a cleared model keeps the chat on its provider.
   * The prefixed thread id follows the active provider's own id, as the pane displays it.
   */
  update(id: string, patch: ChatRecordPatch): ChatRecord {
    const current = this.require(id)
    const modelId = patch.modelId === undefined ? current.modelId : patch.modelId
    const provider = patch.provider ?? (patch.modelId !== undefined && modelId !== null ? chatProviderOfId(modelId) : current.provider)
    const merged: ChatRecord = { ...current, ...patch, modelId, provider, id, createdAt: current.createdAt }
    merged.threadId = chatRecordThreadId(provider, merged)
    merged.preview = merged.preview.slice(0, CHAT_STORE_MAX_PREVIEW)
    this.chats.set(id, merged)
    // The active checkpoint is the saved one only while it belongs to the record's thread, so a
    // thread change can retire it without the checkpoint field itself changing.
    const checkpointChanged = current.checkpoint !== merged.checkpoint || current.threadId !== merged.threadId
    this.changed([id], checkpointChanged ? [id] : [])
    return merged
  }

  archive(id: string): void {
    if (!this.chats.has(id)) return
    this.update(id, { archived: true })
  }

  /** Restore a chat hidden by `archive` before its provider thread is committed. */
  unarchive(id: string): void {
    if (!this.chats.has(id)) return
    this.update(id, { archived: false })
  }

  /** Forget a chat that never became one: no thread, no title, no continuation. */
  remove(id: string): void {
    if (this.chats.delete(id)) this.changed([id])
  }

  /**
   * Take in a thread a provider's catalog knows and the store does not. Its record id is the
   * prefixed thread id, which is already unique across providers, so a later open finds it again.
   */
  adopt(cwd: string, projectPath: string | null, thread: ChatThreadSummary, modelId: string | null): ChatRecord {
    const existing = this.chats.get(thread.id) ?? this.findByThreadId(thread.id)
    if (existing) {
      const title = existing.titleSource === 'generated' || existing.titleSource === 'manual' ? existing.title : thread.title
      const changed = existing.title !== title || existing.updatedAt < thread.updatedAt
      return changed ? this.update(existing.id, { title, updatedAt: Math.max(existing.updatedAt, thread.updatedAt) }) : existing
    }
    const provider = chatProviderOfId(thread.id)
    const bare = bareChatId(provider, thread.id) ?? thread.id
    return this.create({
      id: thread.id,
      cwd,
      projectPath,
      provider,
      modelId,
      reasoningEffort: null,
      codexThreadId: provider === 'codex' ? thread.id : null,
      claudeSessionId: provider === 'claude' ? bare : null,
      antigravityConversationId: provider === 'antigravity' ? bare : null,
      cursorSessionId: provider === 'cursor' ? bare : null,
      title: thread.title,
      preview: thread.preview,
      createdAt: thread.createdAt || thread.updatedAt,
      updatedAt: thread.updatedAt,
      lastTurnEndedAt: thread.updatedAt,
      messageSentAt: thread.updatedAt
    })
  }

  /** Wait for every scheduled write to land; called before quit. */
  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
      this.persist()
    }
    await this.writing
  }

  private changed(ids: string[], checkpointIds: string[] = ids): void {
    this.dirty = true
    if (this.filePath && !this.writeTimer) {
      this.writeTimer = setTimeout(() => {
        this.writeTimer = null
        this.persist()
      }, WRITE_DELAY_MS)
      this.writeTimer.unref?.()
    }
    this.emit('change', { ids, checkpointIds } satisfies ChatStoreChange)
  }

  private persist(): void {
    if (!this.filePath || !this.dirty) return
    this.dirty = false
    const file: ChatStoreFile = { version: 1, chats: [...this.chats.values()] }
    const contents = `${JSON.stringify(file, null, 2)}\n`
    const path = this.filePath
    this.writing = this.writing
      .then(() => writeAtomic(path, contents))
      .catch((error: unknown) => {
        console.warn('[chat-store] could not persist chats:', error instanceof Error ? error.message : String(error))
      })
  }
}
