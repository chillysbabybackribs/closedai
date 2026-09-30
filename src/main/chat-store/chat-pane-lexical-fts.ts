import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ChatIndexLine, ChatPaneLexicalIndexRecord } from '../../shared/chat-index.js'

export const PANE_LEXICAL_FTS_SCHEMA_VERSION = 1

export type PaneLexicalFtsHit = {
  itemId: string
  role: ChatIndexLine['role']
  text: string
  score: number
}

/** Build a quoted AND query for FTS5 token matching (multi-term, same contract as lexical scan). */
export function buildFtsMatchQuery(rawQuery: string): string | null {
  const terms = rawQuery.trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return null
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' AND ')
}

/** SQLite FTS5 backing store for per-pane scope chat search. JSON files remain authoritative. */
export class ChatPaneLexicalFts {
  private db: DatabaseSync | null = null

  constructor(private readonly dir: string) {}

  open(): void {
    if (this.db) return
    mkdirSync(this.dir, { recursive: true })
    this.db = new DatabaseSync(join(this.dir, 'search.sqlite'))
    this.db.exec(`
      PRAGMA busy_timeout=5000;
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      CREATE TABLE IF NOT EXISTS fts_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pane_meta (
        chat_id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        title TEXT,
        last_activity_at INTEGER NOT NULL,
        rotation_epoch INTEGER NOT NULL,
        partial INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    this.ensureFtsTables()
    const row = this.db.prepare(`SELECT value FROM fts_meta WHERE key = 'schema_version'`).get() as { value: string } | undefined
    const version = row ? Number(row.value) : 0
    if (version !== PANE_LEXICAL_FTS_SCHEMA_VERSION) {
      this.db.exec(`DROP TABLE IF EXISTS pane_lines; DROP TABLE IF EXISTS pane_meta;`)
      this.db.exec(`
        CREATE VIRTUAL TABLE pane_lines USING fts5(
          chat_id UNINDEXED,
          item_id UNINDEXED,
          role UNINDEXED,
          line_text,
          tokenize='unicode61 remove_diacritics 2'
        );
        CREATE TABLE pane_meta (
          chat_id TEXT PRIMARY KEY,
          cwd TEXT NOT NULL,
          title TEXT,
          last_activity_at INTEGER NOT NULL,
          rotation_epoch INTEGER NOT NULL,
          partial INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `)
      this.db.prepare(`INSERT INTO fts_meta(key, value) VALUES ('schema_version', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(PANE_LEXICAL_FTS_SCHEMA_VERSION))
    }
  }

  close(): void {
    this.db?.close()
    this.db = null
  }

  private ensureFtsTables(): void {
    if (!this.db) return
    const hasLines = this.db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pane_lines'
    `).get()
    if (hasLines) return
    this.db.exec(`
      CREATE VIRTUAL TABLE pane_lines USING fts5(
        chat_id UNINDEXED,
        item_id UNINDEXED,
        role UNINDEXED,
        line_text,
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TABLE IF NOT EXISTS pane_meta (
        chat_id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        title TEXT,
        last_activity_at INTEGER NOT NULL,
        rotation_epoch INTEGER NOT NULL,
        partial INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
  }

  replaceChat(record: ChatPaneLexicalIndexRecord): void {
    if (!this.db) return
    const replaceLines = this.db.prepare(`
      INSERT INTO pane_lines(chat_id, item_id, role, line_text) VALUES (?, ?, ?, ?)
    `)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`DELETE FROM pane_lines WHERE chat_id = ?`).run(record.chatId)
      this.db.prepare(`DELETE FROM pane_meta WHERE chat_id = ?`).run(record.chatId)
      this.db.prepare(`
        INSERT INTO pane_meta(chat_id, cwd, title, last_activity_at, rotation_epoch, partial, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.chatId,
        record.cwd,
        record.title,
        record.lastActivityAt,
        record.rotationEpoch,
        record.partial ? 1 : 0,
        record.updatedAt
      )
      for (const line of record.lines) {
        replaceLines.run(record.chatId, line.itemId, line.role, line.text)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  removeChat(chatId: string): void {
    if (!this.db) return
    this.db.prepare(`DELETE FROM pane_lines WHERE chat_id = ?`).run(chatId)
    this.db.prepare(`DELETE FROM pane_meta WHERE chat_id = ?`).run(chatId)
  }

  search(chatId: string, matchQuery: string, limit: number): PaneLexicalFtsHit[] {
    if (!this.db) return []
    const rows = this.db.prepare(`
      SELECT item_id AS itemId, role, line_text AS text, bm25(pane_lines) AS rank
      FROM pane_lines
      WHERE chat_id = ? AND pane_lines MATCH ?
      ORDER BY rank DESC
      LIMIT ?
    `).all(chatId, matchQuery, limit) as Array<{ itemId: string; role: ChatIndexLine['role']; text: string; rank: number }>
    return rows.map((row) => ({
      itemId: row.itemId,
      role: row.role,
      text: row.text,
      score: Number.isFinite(row.rank) ? row.rank : 0
    }))
  }

  meta(chatId: string): Pick<ChatPaneLexicalIndexRecord, 'cwd' | 'title' | 'lastActivityAt' | 'rotationEpoch' | 'partial'> | null {
    if (!this.db) return null
    const row = this.db.prepare(`
      SELECT cwd, title, last_activity_at AS lastActivityAt, rotation_epoch AS rotationEpoch, partial
      FROM pane_meta WHERE chat_id = ?
    `).get(chatId) as { cwd: string; title: string | null; lastActivityAt: number; rotationEpoch: number; partial: number } | undefined
    if (!row) return null
    return { ...row, partial: row.partial !== 0 }
  }
}
