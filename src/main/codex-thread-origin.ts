import { open, type FileHandle } from 'node:fs/promises'

// Codex threads live in one store per machine (~/.codex/sessions), shared by every client:
// this app, the Codex CLI, and the Codex desktop app. `thread/list` returns all of them for a
// working directory, so the pane's history filled up with other apps' conversations — and the
// live ones cannot even be opened, because whichever app has them holds the store's writer lock
// and `thread/resume` refuses. The rollout file records which client started the thread, which
// is the only field that tells them apart (`source` is "vscode" for all of them).

/** The name this app sends as `clientInfo` on `initialize`, which Codex records per thread. */
export const CLOSEDAI_ORIGINATOR = 'closedai'

// The meta record is the first line of the rollout, but it embeds the thread's instructions and
// runs to tens of kilobytes, so it is read a chunk at a time up to a ceiling rather than in one
// fixed-size peek — a truncated line parses as nothing and would make every thread look foreign.
const CHUNK_BYTES = 16_384
const MAX_HEADER_BYTES = 512 * 1024
const NEWLINE = 0x0a

export type ThreadOriginReader = (path: string) => Promise<string | null>

/**
 * Read a rollout's originator. Anything unreadable or unparsable answers null, which callers
 * treat as "cannot tell" rather than "not ours" — hiding a chat is worse than listing one.
 */
export const readThreadOriginator: ThreadOriginReader = async (path) => {
  let handle
  try {
    handle = await open(path, 'r')
    const line = await firstLine(handle)
    if (!line) return null
    const record = JSON.parse(line) as { originator?: unknown; payload?: { originator?: unknown } }
    const originator = record.payload?.originator ?? record.originator
    return typeof originator === 'string' ? originator : null
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}

/** The file's first line, decoded once from whole bytes so a chunk edge cannot split a character. */
async function firstLine(handle: FileHandle): Promise<string | null> {
  const chunks: Buffer[] = []
  for (let offset = 0; offset < MAX_HEADER_BYTES; offset += CHUNK_BYTES) {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(CHUNK_BYTES), 0, CHUNK_BYTES, offset)
    if (bytesRead === 0) break
    const chunk = buffer.subarray(0, bytesRead)
    const end = chunk.indexOf(NEWLINE)
    chunks.push(end < 0 ? chunk : chunk.subarray(0, end))
    if (end >= 0) return Buffer.concat(chunks).toString('utf8')
  }
  return null
}

/** How many rollout headers are read at once; the list is capped at 100 threads. */
const READ_CONCURRENCY = 8

/**
 * Keep the threads this app recorded. A row without a path, or whose header cannot be read,
 * is kept: the point is to drop another app's chats, not to lose one of ours to an I/O error.
 */
export async function ownThreadRows(
  rows: readonly unknown[],
  read: ThreadOriginReader = readThreadOriginator
): Promise<unknown[]> {
  const kept: unknown[] = []
  for (let start = 0; start < rows.length; start += READ_CONCURRENCY) {
    const batch = rows.slice(start, start + READ_CONCURRENCY)
    const verdicts = await Promise.all(batch.map(async (row) => {
      const path = (row as { path?: unknown } | null)?.path
      if (typeof path !== 'string' || !path) return true
      const originator = await read(path)
      return originator === null || originator === CLOSEDAI_ORIGINATOR
    }))
    for (const [index, keep] of verdicts.entries()) if (keep) kept.push(batch[index])
  }
  return kept
}
