import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import type { ChatThreadSummary, ChatTranscriptItem } from '../../shared/chat.js'
import { writeAtomic } from '../atomic-write.js'
import { ANTIGRAVITY_STATE_DIR } from './antigravity-cli.js'
import { antigravityThreadId } from './antigravity-ids.js'

// Antigravity conversations live in the CLI's own store (~/.gemini/antigravity-cli) as SQLite
// files of protobuf steps, which the app cannot read back. The CLI's `conversation_summaries.db`
// carries generated titles, but on agy 1.1.24 it stopped receiving rows for headless (`--print`)
// conversations (verified 2026-09-02: none of the day's conversations appeared). So the app is
// the record: an index of every conversation it ran for a workspace (title from the first
// message, timestamps), a copy of each transcript written after every turn, and an archived set,
// since the CLI has no tag or delete verb. The CLI table is consulted only for a nicer title.

const MAX_THREADS = 100

type IndexEntry = { conversationId: string; cwd: string; title: string; preview: string; createdAt: number; updatedAt: number }
type StoredTranscript = { conversationId: string; items: ChatTranscriptItem[]; updatedAt: number }

export class AntigravityHistory {
  constructor(
    private readonly stateDir: string,
    private readonly summariesDbPath = join(ANTIGRAVITY_STATE_DIR, 'conversation_summaries.db')
  ) {}

  /** Conversations this app ran for the workspace, newest first, minus the archived ones. */
  async listThreads(cwd: string): Promise<ChatThreadSummary[]> {
    const [archived, index] = await Promise.all([this.archivedIds(), this.readIndex()])
    const titles = this.readCliTitles()
    const workspace = workspaceKey(cwd)
    return Object.values(index)
      .filter((entry) => !archived.has(entry.conversationId) && workspaceKey(entry.cwd) === workspace)
      .map((entry): ChatThreadSummary => ({
        id: antigravityThreadId(entry.conversationId),
        title: titles.get(entry.conversationId) || entry.title || 'New chat',
        preview: entry.preview,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_THREADS)
  }

  /** The CLI's generated title for a conversation, when its summary table has one. */
  async threadName(conversationId: string): Promise<string | null> {
    return this.readCliTitles().get(conversationId) || null
  }

  /** Record (or refresh) a conversation in the workspace index from its transcript. */
  async recordThread(conversationId: string, cwd: string, items: ChatTranscriptItem[]): Promise<void> {
    const index = await this.readIndex()
    const first = items.find((item) => item.type === 'user')
    const text = first?.type === 'user' ? first.text : ''
    const now = Date.now()
    const existing = index[conversationId]
    index[conversationId] = {
      conversationId,
      cwd,
      title: existing?.title || firstLine(text) || (first?.type === 'user' ? first.attachments?.[0]?.name ?? '' : ''),
      preview: existing?.preview || text.slice(0, 200),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    await mkdir(this.stateDir, { recursive: true })
    await writeAtomic(this.indexPath(), JSON.stringify(index, null, 2))
  }

  async archive(conversationId: string): Promise<void> {
    const archived = await this.archivedIds()
    archived.add(conversationId)
    await mkdir(this.stateDir, { recursive: true })
    await writeAtomic(this.archivedPath(), JSON.stringify([...archived], null, 2))
  }

  async saveTranscript(conversationId: string, items: ChatTranscriptItem[]): Promise<void> {
    const stored: StoredTranscript = { conversationId, items, updatedAt: Date.now() }
    await mkdir(join(this.stateDir, 'transcripts'), { recursive: true })
    await writeAtomic(this.transcriptPath(conversationId), JSON.stringify(stored))
  }

  /** The app's copy of a conversation's transcript, or null when this app never showed it. */
  async loadTranscript(conversationId: string): Promise<ChatTranscriptItem[] | null> {
    try {
      const parsed = JSON.parse(await readFile(this.transcriptPath(conversationId), 'utf8')) as Partial<StoredTranscript>
      return Array.isArray(parsed.items) ? parsed.items : null
    } catch {
      return null
    }
  }

  private readCliTitles(): Map<string, string> {
    let db: DatabaseSync | null = null
    try {
      db = new DatabaseSync(this.summariesDbPath)
      const rows = db.prepare('SELECT conversation_id, title FROM conversation_summaries').all() as unknown[]
      const titles = new Map<string, string>()
      for (const row of rows) {
        const record = row as Record<string, unknown>
        if (typeof record.conversation_id === 'string' && typeof record.title === 'string' && record.title.trim()) {
          titles.set(record.conversation_id, record.title.trim())
        }
      }
      return titles
    } catch {
      return new Map()
    } finally {
      db?.close()
    }
  }

  private async readIndex(): Promise<Record<string, IndexEntry>> {
    try {
      const parsed = JSON.parse(await readFile(this.indexPath(), 'utf8')) as Record<string, Partial<IndexEntry>>
      const index: Record<string, IndexEntry> = {}
      for (const [id, entry] of Object.entries(parsed)) {
        if (typeof entry?.cwd !== 'string' || typeof entry.updatedAt !== 'number') continue
        index[id] = {
          conversationId: id,
          cwd: entry.cwd,
          title: typeof entry.title === 'string' ? entry.title : '',
          preview: typeof entry.preview === 'string' ? entry.preview : '',
          createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : entry.updatedAt,
          updatedAt: entry.updatedAt
        }
      }
      return index
    } catch {
      return {}
    }
  }

  private async archivedIds(): Promise<Set<string>> {
    try {
      const parsed = JSON.parse(await readFile(this.archivedPath(), 'utf8')) as unknown
      return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
    } catch {
      return new Set()
    }
  }

  private indexPath(): string {
    return join(this.stateDir, 'threads.json')
  }

  private archivedPath(): string {
    return join(this.stateDir, 'archived.json')
  }

  private transcriptPath(conversationId: string): string {
    return join(this.stateDir, 'transcripts', `${conversationId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`)
  }
}

function workspaceKey(cwd: string): string {
  return pathToFileURL(cwd).href.replace(/\/+$/, '')
}

/** The first line of the user's own words, without the app's context blocks. */
export function firstLine(text: string): string {
  const line = text.replace(/<closedai_context\b[^>]*>[\s\S]*?<\/closedai_context>\s*/g, '').split('\n')[0]?.trim() ?? ''
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line
}
