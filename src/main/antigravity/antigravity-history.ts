import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import type { ChatThreadSummary, ChatTranscriptItem } from '../../shared/chat.js'
import { writeAtomic } from '../atomic-write.js'
import { ANTIGRAVITY_STATE_DIR } from './antigravity-cli.js'
import { antigravityThreadId } from './antigravity-ids.js'

// Antigravity threads live in the CLI's own store (~/.gemini/antigravity-cli): every conversation
// is a SQLite file of protobuf steps, and `conversation_summaries.db` carries the title the CLI
// generates, a preview, timestamps, and the workspaces the conversation was added to. The app
// lists that summary table for its workspace. The steps themselves are opaque, so the app keeps
// its own copy of each conversation's transcript (written after every turn) to show when a
// thread is reopened, and an archived set, since the CLI has no tag or delete verb.

const MAX_THREADS = 100

type SummaryRow = {
  conversation_id: string
  title: string
  preview: string
  last_modified_time: string
  last_user_input_time: string
  workspace_uris: string
  nesting_depth: number
}

type StoredTranscript = { conversationId: string; items: ChatTranscriptItem[]; updatedAt: number }

export class AntigravityHistory {
  constructor(
    private readonly stateDir: string,
    private readonly summariesDbPath = join(ANTIGRAVITY_STATE_DIR, 'conversation_summaries.db')
  ) {}

  /** Conversations recorded for this workspace, newest first, minus the archived ones. */
  async listThreads(cwd: string): Promise<ChatThreadSummary[]> {
    const archived = await this.archivedIds()
    const rows = this.readSummaries()
    const workspace = workspaceUri(cwd)
    return rows
      .filter((row) => row.nesting_depth === 0 && !archived.has(row.conversation_id) && workspacesOf(row).includes(workspace))
      .map(threadSummary)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_THREADS)
  }

  /** The CLI's generated title for a conversation, once it has one. */
  async threadName(conversationId: string): Promise<string | null> {
    const row = this.readSummaries().find((entry) => entry.conversation_id === conversationId)
    return row?.title?.trim() || null
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

  private readSummaries(): SummaryRow[] {
    let db: DatabaseSync | null = null
    try {
      db = new DatabaseSync(this.summariesDbPath)
      const rows = db.prepare(
        'SELECT conversation_id, title, preview, last_modified_time, last_user_input_time, workspace_uris, nesting_depth FROM conversation_summaries'
      ).all() as unknown[]
      return rows.flatMap((row) => {
        const record = row as Record<string, unknown>
        return typeof record.conversation_id === 'string' && record.conversation_id
          ? [{
              conversation_id: record.conversation_id,
              title: String(record.title ?? ''),
              preview: String(record.preview ?? ''),
              last_modified_time: String(record.last_modified_time ?? ''),
              last_user_input_time: String(record.last_user_input_time ?? ''),
              workspace_uris: String(record.workspace_uris ?? ''),
              nesting_depth: Number(record.nesting_depth ?? 0)
            }]
          : []
      })
    } catch {
      return []
    } finally {
      db?.close()
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

  private archivedPath(): string {
    return join(this.stateDir, 'archived.json')
  }

  private transcriptPath(conversationId: string): string {
    return join(this.stateDir, 'transcripts', `${conversationId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`)
  }
}

function threadSummary(row: SummaryRow): ChatThreadSummary {
  const preview = previewText(row.preview)
  const updatedAt = parseCliTime(row.last_modified_time) ?? 0
  return {
    id: antigravityThreadId(row.conversation_id),
    title: row.title.trim() || firstLine(preview) || 'New chat',
    preview,
    createdAt: parseCliTime(row.last_user_input_time) ?? updatedAt,
    updatedAt
  }
}

function workspacesOf(row: SummaryRow): string[] {
  try {
    const parsed = JSON.parse(row.workspace_uris) as unknown
    return Array.isArray(parsed) ? parsed.filter((uri): uri is string => typeof uri === 'string').map(normalizeUri) : []
  } catch {
    return []
  }
}

function workspaceUri(cwd: string): string {
  return normalizeUri(pathToFileURL(cwd).href)
}

function normalizeUri(uri: string): string {
  try {
    return decodeURIComponent(uri).replace(/\/+$/, '')
  } catch {
    return uri.replace(/\/+$/, '')
  }
}

/** The CLI writes Go timestamps: `2026-08-30 17:54:50.501242631+00:00`; the zero time means unset. */
export function parseCliTime(value: string): number | null {
  if (!value || value.startsWith('0001-')) return null
  const iso = value.trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1')
  const time = Date.parse(iso)
  return Number.isFinite(time) ? time : null
}

/** The preview without the app's own context blocks, which the CLI records as part of the prompt. */
export function previewText(text: string): string {
  return text
    .replace(/<closedai_context\b[^>]*>[\s\S]*?<\/closedai_context>\s*/g, '')
    .replace(/<project_instructions\b[^>]*>[\s\S]*?(<\/project_instructions>|$)\s*/g, '')
    .trim()
}

function firstLine(text: string): string {
  const line = text.split('\n')[0]?.trim() ?? ''
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line
}
