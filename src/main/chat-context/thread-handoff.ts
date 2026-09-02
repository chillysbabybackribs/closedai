import type { ChatTranscriptItem } from '../../shared/chat.js'
import type { AdditionalContext } from './turn-context.js'

// "Continue in new chat": a fresh thread starts with a short digest of the one it replaces
// instead of that thread's full history. The digest is built from the app's own transcript
// (no model call, so it is instant) and only carries what the model cannot re-derive from the
// workspace: what the user asked, what Codex concluded, and which files changed. Tool output,
// screenshots, and reasoning are deliberately left behind; they are what made the old thread slow.

export const THREAD_HANDOFF_CONTEXT = 'closedai.chat.handoff'

/** Total digest size; about 3k tokens, small enough to survive later compactions cheaply. */
const MAX_HANDOFF_CHARS = 12_000
const MAX_ENTRY_CHARS = 1_500
const MAX_CHANGED_FILES = 30

type HandoffEntry = { speaker: 'User' | 'Codex'; text: string }

export type ThreadHandoff = {
  /** The thread's name, else its opening request as the history list would show it. */
  title: string
  text: string
}

/** Digest of a transcript for the thread that continues it, or null when there is nothing to carry. */
export function buildThreadHandoff(items: ChatTranscriptItem[], threadName: string | null): ThreadHandoff | null {
  const entries = conversationEntries(items)
  if (entries.length === 0) return null
  const title = threadName ?? clip(entries[0]!.text.split('\n')[0] ?? '', 60)
  const header = [
    `Handoff from the previous chat "${title}".`,
    'The user continued that conversation here to keep the context small. Any edits made there are already on disk; re-read files rather than trusting this digest for exact contents.'
  ]
  const files = changedFiles(items)
  if (files.length > 0) header.push(`Files changed there: ${files.join(', ')}`)
  const conversation = fitEntries(entries, MAX_HANDOFF_CHARS - header.join('\n').length - 60)
  return { title, text: [...header, '', 'Conversation so far (oldest first; long messages trimmed):', ...conversation].join('\n') }
}

/** The turn-context fragment that carries the digest into the new thread's first turn. */
export function handoffAdditionalContext(handoff: string): AdditionalContext {
  return { [THREAD_HANDOFF_CONTEXT]: { kind: 'application', value: handoff } }
}

/** User messages plus one assistant answer per turn: the final answer, else the last message. */
function conversationEntries(items: ChatTranscriptItem[]): HandoffEntry[] {
  const entries: HandoffEntry[] = []
  const answerIndexByTurn = new Map<string, number>()
  for (const item of items) {
    if (item.type === 'user') {
      const attachments = item.attachments?.map((attachment) => attachment.name) ?? []
      const text = [item.text.trim(), attachments.length ? `[attached: ${attachments.join(', ')}]` : '']
        .filter(Boolean).join(' ')
      if (text) entries.push({ speaker: 'User', text })
      continue
    }
    if (item.type !== 'assistant' || !item.text.trim()) continue
    const turnKey = item.turnId ?? item.id
    const existing = answerIndexByTurn.get(turnKey)
    if (existing === undefined) {
      answerIndexByTurn.set(turnKey, entries.length)
      entries.push({ speaker: 'Codex', text: item.text.trim() })
    } else if (item.phase === 'final_answer' || entries[existing]!.text !== item.text.trim()) {
      // Commentary streams before the answer; the answer (or the latest message) wins.
      const current = entries[existing]!
      if (item.phase === 'final_answer' || current.speaker === 'Codex') entries[existing] = { speaker: 'Codex', text: item.text.trim() }
    }
  }
  return entries
}

function changedFiles(items: ChatTranscriptItem[]): string[] {
  const paths = new Set<string>()
  for (const item of items) {
    if (item.type !== 'fileChange') continue
    for (const change of item.changes) if (change.path) paths.add(change.path)
  }
  return [...paths].slice(-MAX_CHANGED_FILES)
}

/** Keep the opening request and as much of the recent conversation as the budget allows. */
function fitEntries(entries: HandoffEntry[], budget: number): string[] {
  const lines = entries.map((entry) => `${entry.speaker}: ${clip(entry.text, MAX_ENTRY_CHARS)}`)
  const first = lines[0]!
  let remaining = budget - first.length
  const tail: string[] = []
  for (let index = lines.length - 1; index >= 1; index -= 1) {
    const line = lines[index]!
    if (line.length + 1 > remaining) break
    remaining -= line.length + 1
    tail.unshift(line)
  }
  const skipped = lines.length - 1 - tail.length
  return [first, ...(skipped > 0 ? [`[${skipped} earlier message${skipped === 1 ? '' : 's'} omitted]`] : []), ...tail]
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}
