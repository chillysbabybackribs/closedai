import type { ChatFileChange, ChatTranscriptItem } from '../../shared/chat.js'
import { jsonPreview, recordOf, stringOf } from '../claude/claude-tool-items.js'

// Pure translations from ACP tool calls to the transcript vocabulary Codex items use, so the
// renderer's activity rows and diffs need no provider branches. ACP already normalises what the
// other adapters have to recover per tool: every call carries a human `title`, a `kind`
// (read | edit | execute | search | think | fetch | move | delete | other), a `status`, and
// optional `content` blocks — so this file is a mapping, not a per-tool table.
//
// Verified live (cursor-agent 2026.09.02-c22c1a3, 2026-09-03): a shell call arrives as
// `kind: "execute"` with `rawInput.command` and title `` `echo hi` ``; a file read arrives as
// `kind: "read"` with `rawInput.path`, `locations`, and `rawOutput.content`.

export type CursorToolCall = {
  id: string
  title: string
  kind: string
  rawInput: Record<string, unknown>
}

export type CursorToolOutcome = {
  status: 'completed' | 'failed'
  output: string
  diffs: ChatFileChange[]
}

const MAX_OUTPUT_CHARS = 24_000
const MAX_TOOL_OUTPUT_CHARS = 4_000

/** ACP statuses in the transcript's vocabulary. */
export function cursorStatus(status: unknown): 'pending' | 'inProgress' | 'completed' | 'failed' {
  switch (status) {
    case 'in_progress': return 'inProgress'
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    default: return 'pending'
  }
}

/** The transcript item for a tool call as it starts. */
export function cursorToolItem(call: CursorToolCall, turnId: string | null, cwd: string): ChatTranscriptItem {
  const { id, rawInput } = call
  if (call.kind === 'execute') {
    return {
      type: 'command',
      id,
      turnId,
      command: stringOf(rawInput.command) || unquoteTitle(call.title),
      cwd: stringOf(rawInput.cwd) || cwd,
      status: 'inProgress',
      output: '',
      exitCode: null
    }
  }
  return { type: 'tool', id, turnId, label: call.title || call.kind || 'tool', detail: detailOf(rawInput), status: 'inProgress' }
}

/** The same item once ACP reported a settled status, with whatever the call produced. */
export function cursorToolResult(item: ChatTranscriptItem, outcome: CursorToolOutcome): ChatTranscriptItem {
  const { status } = outcome
  const output = clip(outcome.output)
  if (item.type === 'command') {
    return { ...item, status, output, exitCode: status === 'failed' ? exitCodeIn(output) : 0 }
  }
  // An edit only becomes a diff row once ACP has actually sent the before/after text.
  if (outcome.diffs.length) {
    return { type: 'fileChange', id: item.id, turnId: item.turnId, status, changes: outcome.diffs }
  }
  if (item.type === 'fileChange') return { ...item, status }
  if (item.type === 'tool') {
    const result = output.slice(0, MAX_TOOL_OUTPUT_CHARS).trim()
    return result ? { ...item, status, output: result } : { ...item, status }
  }
  return item
}

/** Text and diffs carried by an ACP `content` array, plus whatever `rawOutput` adds. */
export function cursorToolContent(content: unknown, rawOutput: unknown): { text: string; diffs: ChatFileChange[] } {
  const blocks = Array.isArray(content) ? content : []
  const parts: string[] = []
  const diffs: ChatFileChange[] = []
  for (const entry of blocks) {
    const block = recordOf(entry)
    if (block.type === 'diff') {
      const path = stringOf(block.path)
      if (!path) continue
      const oldText = stringOf(block.oldText)
      diffs.push({ path, kind: oldText ? 'update' : 'add', diff: editDiff(oldText, stringOf(block.newText)) })
      continue
    }
    const inner = recordOf(block.content)
    const text = stringOf(inner.text) || stringOf(block.text)
    if (text) parts.push(text)
  }
  const raw = recordOf(rawOutput)
  const rawText = stringOf(raw.content) || stringOf(raw.output) || stringOf(raw.result)
  if (rawText) parts.push(rawText)
  else if (!parts.length && rawOutput !== undefined && Object.keys(raw).length) parts.push(jsonPreview(raw))
  return { text: parts.join('\n').trim(), diffs }
}

function detailOf(rawInput: Record<string, unknown>): string {
  const path = stringOf(rawInput.path) || stringOf(rawInput.file_path)
  if (path) return path
  const query = stringOf(rawInput.query) || stringOf(rawInput.pattern)
  if (query) return query
  return Object.keys(rawInput).length ? jsonPreview(rawInput) : ''
}

/** ACP titles a shell call with the command in backticks; the command row wants it bare. */
function unquoteTitle(title: string): string {
  const match = /^`(.*)`$/s.exec(title.trim())
  return match ? match[1]! : title
}

function editDiff(before: string, after: string): string {
  return [before ? prefixLines('-', before) : '', after ? prefixLines('+', after) : ''].filter(Boolean).join('\n')
}

function prefixLines(prefix: string, text: string): string {
  return text ? text.split('\n').map((line) => `${prefix}${line}`).join('\n') : ''
}

function exitCodeIn(text: string): number | null {
  const match = /\bexit (?:code|status)[: ]+(\d+)/i.exec(text)
  return match ? Number(match[1]) : null
}

function clip(text: string): string {
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}…` : text
}
