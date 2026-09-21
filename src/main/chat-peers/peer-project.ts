import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { ChatSnapshot } from '../../shared/chat.js'
import type { ChatRecord, ChatRecordPatch } from '../../shared/chat-store.js'
import { buildThreadHandoff } from '../chat-context/thread-handoff.js'
import type { AppSettingsAccess } from '../app-settings-store.js'

type Selection = { cwd: string; projectPath: string | null }
type Host = {
  record(id: string): ChatRecord
  idle(id: string): boolean
  apply(id: string, selection: Selection): Promise<void>
  changed(): void
  failed(id: string, error: unknown): void
}

/** Per-chat directory changes wait for that chat alone; the latest choice replaces a queued one. */
export class PeerProjectChanges {
  private readonly pending = new Map<string, Selection>()
  private readonly applying = new Map<string, Promise<void>>()
  private stopped = false

  constructor(private readonly host: Host) {}

  selection(id: string): Selection | undefined { return this.pending.get(id) }

  async request(id: string, projectPath: string | null): Promise<void> {
    if (this.applying.has(id)) throw new Error('This chat is already changing directories')
    const cwd = resolve(projectPath ?? homedir())
    if (!(await stat(cwd)).isDirectory()) throw new Error('Choose a project folder')
    if (this.stopped) throw new Error('The chat workspace has closed')
    if (this.applying.has(id)) throw new Error('This chat is already changing directories')
    const record = this.host.record(id)
    const next = { cwd, projectPath: projectPath === null ? null : cwd }
    if (record.cwd === cwd && record.projectPath === next.projectPath) this.pending.delete(id)
    else this.pending.set(id, next)
    this.host.changed()
    await this.flush(id)
  }

  async flush(id: string): Promise<void> {
    const active = this.applying.get(id)
    if (active) return active
    const next = this.pending.get(id)
    if (!next || this.stopped || !this.host.idle(id)) return
    // Enter the operation map before apply runs: provider events may synchronously call observe.
    const work = Promise.resolve().then(async () => {
      if (this.pending.get(id) !== next || this.stopped) return
      try {
        if (!(await stat(next.cwd)).isDirectory()) throw new Error('The selected folder is no longer a directory')
        await this.host.apply(id, next)
        if (this.pending.get(id) === next) this.pending.delete(id)
      } catch (error) {
        if (this.pending.get(id) === next) this.pending.delete(id)
        throw error
      } finally {
        this.host.changed()
      }
    })
    this.applying.set(id, work)
    try { await work } finally { this.applying.delete(id) }
  }

  observe(id: string): void {
    if (!this.pending.has(id) || this.applying.has(id)) return
    queueMicrotask(() => { void this.flush(id).catch((error: unknown) => this.host.failed(id, error)) })
  }

  cancel(id: string): void { this.pending.delete(id) }
  stop(): void { this.stopped = true; this.pending.clear() }
}

/** A fresh provider session receives the existing handoff in the new cwd; chat identity survives. */
export function projectConversationPatch(record: ChatRecord, source: ChatSnapshot, selection: Selection): ChatRecordPatch {
  const checkpoint = record.checkpoint?.threadId === source.threadId ? record.checkpoint : null
  const handoff = buildThreadHandoff(source.items, source.threadName, checkpoint)
  return {
    ...selection,
    codexThreadId: null, claudeSessionId: null, antigravityConversationId: null, cursorSessionId: null,
    continuation: handoff ? {
      sourcePaneId: record.id, sourceThreadId: source.threadId ?? record.continuation?.sourceThreadId ?? null,
      sourceCwd: source.threadId ? record.cwd : record.continuation?.sourceCwd ?? record.cwd,
      sourceProvider: source.provider,
      sourceTitle: handoff.title, sourceThroughItemId: source.items.at(-1)?.id ?? null,
      checkpoint, handoff: handoff.text, createdAt: Date.now()
    } : record.continuation
  }
}

/** Remember both folders without selecting a different workspace or restoring its layout. */
export async function rememberChatProjects(settings: AppSettingsAccess, ...selections: Selection[]): Promise<void> {
  const recent = settings.get().chatWorkspaces
  for (const selection of selections) {
    const index = recent.findIndex((entry) => entry.cwd === selection.cwd && entry.projectPath === selection.projectPath)
    const existing = index < 0 ? null : recent.splice(index, 1)[0]
    recent.push(existing ?? { ...selection, openIds: [], peers: [], selectedPaneId: null })
  }
  await settings.set({ chatWorkspaces: recent })
}
