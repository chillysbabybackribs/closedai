import type { ChatTranscriptItem } from '../../shared/chat.js'
import { recordOf, stringOf } from '../claude/claude-tool-items.js'
import { cursorStatus, cursorToolContent, cursorToolItem, cursorToolResult } from './cursor-tool-items.js'

// Pure translation from one turn's ACP `session/update` notifications to transcript operations,
// so the session only applies ops. Verified live (cursor-agent 2026.09.02-c22c1a3, 2026-09-03).
//
// Update kinds handled: `agent_message_chunk` and `agent_thought_chunk` (true deltas — unlike
// the one-shot `--print` stream, no full-text repeat arrives at the end, so the chunks ARE the
// transcript), `tool_call` and `tool_call_update` (a call is announced with `status: "pending"`
// and its `rawInput` often only arrives on the first update), `plan`, `session_info_update`
// (the agent's own title for the chat), and `current_mode_update`. `available_commands_update`
// is deliberately ignored: the pane has no slash-command surface to put it in.
//
// Text and tools interleave, so a tool call closes the open assistant item; the next chunk
// starts a new one. That keeps a reply that resumes after a tool from being appended to text
// the user already saw settle.

export type TranscriptOp =
  | { type: 'item'; item: ChatTranscriptItem }
  | { type: 'delta'; itemId: string; field: 'text'; delta: string }
  | { type: 'notice'; text: string; tone: 'info' | 'error' }

export type TurnEnd = { status: 'completed' | 'interrupted' | 'failed'; error?: string }

export type CursorTranslation = { ops: TranscriptOp[]; title?: string; modeId?: string }

export type CursorTranslatorOptions = {
  /** Null when replaying a stored session, where the items belong to no turn of this run. */
  turnId: string | null
  /** What item ids are built from: the turn id live, the session id on a replay. */
  seed: string
  cwd: string
}

type OpenText = { id: string; text: string; kind: 'assistant' | 'reasoning' | 'user' }

export class CursorTurnTranslator {
  private readonly tools = new Map<string, ChatTranscriptItem>()
  private open: OpenText | null = null
  private seq = 0
  private settled = false

  constructor(private readonly options: CursorTranslatorOptions) {}

  handle(raw: unknown): CursorTranslation {
    const update = recordOf(recordOf(raw).update)
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        return { ops: this.handleText('assistant', chunkText(update)) }
      case 'agent_thought_chunk':
        return { ops: this.handleText('reasoning', chunkText(update)) }
      // Only ever seen on a `session/load` replay; a live turn's own message is added
      // optimistically by the service before the prompt is sent.
      case 'user_message_chunk':
        return { ops: this.handleText('user', chunkText(update)) }
      case 'tool_call':
        return { ops: this.handleToolCall(update) }
      case 'tool_call_update':
        return { ops: this.handleToolUpdate(update) }
      case 'plan':
        return { ops: this.handlePlan(update) }
      case 'session_info_update': {
        const title = stringOf(update.title)
        return title ? { ops: [], title } : { ops: [] }
      }
      case 'current_mode_update': {
        const modeId = stringOf(update.currentModeId)
        return modeId ? { ops: [], modeId } : { ops: [] }
      }
      default:
        return { ops: [] }
    }
  }

  /** Close whatever the turn left open when it ends without ACP settling it. */
  finish(): TranscriptOp[] {
    if (this.settled) return []
    this.settled = true
    const ops = this.closeText()
    for (const [id, item] of this.tools) {
      if (!inProgress(item)) continue
      const closed = cursorToolResult(item, {
        status: 'failed',
        output: 'The turn ended before this tool call reported a result.',
        diffs: []
      })
      this.tools.set(id, closed)
      ops.push({ type: 'item', item: closed })
    }
    return ops
  }

  private handleText(kind: OpenText['kind'], delta: string): TranscriptOp[] {
    if (!delta) return []
    if (this.open && this.open.kind !== kind) {
      const ops = this.closeText()
      return [...ops, ...this.handleText(kind, delta)]
    }
    if (!this.open) {
      this.seq += 1
      this.open = { id: `${this.options.seed}:t${this.seq}`, text: delta, kind }
      return [{ type: 'item', item: this.textItem(this.open, true) }]
    }
    this.open.text += delta
    return [{ type: 'delta', itemId: this.open.id, field: 'text', delta }]
  }

  private closeText(): TranscriptOp[] {
    const open = this.open
    if (!open) return []
    this.open = null
    return [{ type: 'item', item: this.textItem(open, false) }]
  }

  private handleToolCall(update: Record<string, unknown>): TranscriptOp[] {
    const id = stringOf(update.toolCallId)
    if (!id || this.tools.has(id)) return this.handleToolUpdate(update)
    const ops = this.closeText()
    const item = cursorToolItem(
      { id, title: stringOf(update.title), kind: stringOf(update.kind), rawInput: recordOf(update.rawInput) },
      this.options.turnId,
      this.options.cwd
    )
    this.tools.set(id, item)
    ops.push({ type: 'item', item })
    return [...ops, ...this.settle(id, update)]
  }

  private handleToolUpdate(update: Record<string, unknown>): TranscriptOp[] {
    const id = stringOf(update.toolCallId)
    const item = id ? this.tools.get(id) : null
    if (!id || !item) return []
    // The announcement often carries an empty `rawInput`; the first update fills it in.
    const rawInput = recordOf(update.rawInput)
    const refreshed = Object.keys(rawInput).length || stringOf(update.title)
      ? this.relabel(item, update, rawInput)
      : item
    const ops: TranscriptOp[] = refreshed === item ? [] : [{ type: 'item', item: refreshed }]
    this.tools.set(id, refreshed)
    return [...ops, ...this.settle(id, update)]
  }

  /** Apply a settled ACP status; a still-running call stays as it is. */
  private settle(id: string, update: Record<string, unknown>): TranscriptOp[] {
    const status = cursorStatus(update.status)
    if (status !== 'completed' && status !== 'failed') return []
    const item = this.tools.get(id)
    if (!item || !inProgress(item)) return []
    const { text, diffs } = cursorToolContent(update.content, update.rawOutput)
    const settled = cursorToolResult(item, { status, output: text, diffs })
    this.tools.set(id, settled)
    return [{ type: 'item', item: settled }]
  }

  private relabel(
    item: ChatTranscriptItem,
    update: Record<string, unknown>,
    rawInput: Record<string, unknown>
  ): ChatTranscriptItem {
    if (!inProgress(item)) return item
    const rebuilt = cursorToolItem(
      { id: item.id, title: stringOf(update.title) || labelOf(item), kind: kindOf(item), rawInput },
      this.options.turnId,
      this.options.cwd
    )
    return rebuilt.type === item.type ? rebuilt : item
  }

  private handlePlan(update: Record<string, unknown>): TranscriptOp[] {
    const entries = Array.isArray(update.entries) ? update.entries : []
    const text = entries.map((entry) => {
      const record = recordOf(entry)
      const done = record.status === 'completed'
      const running = record.status === 'in_progress'
      return `- [${done ? 'x' : ' '}] ${stringOf(record.content)}${running ? ' _(in progress)_' : ''}`
    }).join('\n')
    if (!text) return []
    const ops = this.closeText()
    ops.push({
      type: 'item',
      item: { type: 'plan', id: `${this.options.seed}:plan`, turnId: this.options.turnId, text, streaming: false }
    })
    return ops
  }

  private textItem(open: OpenText, streaming: boolean): ChatTranscriptItem {
    const { turnId } = this.options
    if (open.kind === 'user') return { type: 'user', id: open.id, turnId, text: open.text }
    if (open.kind === 'reasoning') {
      return { type: 'reasoning', id: open.id, turnId, text: open.text, streaming }
    }
    return { type: 'assistant', id: open.id, turnId, text: open.text, phase: null, streaming }
  }
}

function chunkText(update: Record<string, unknown>): string {
  const content = recordOf(update.content)
  return stringOf(content.text)
}

function inProgress(item: ChatTranscriptItem): boolean {
  return (item.type === 'command' || item.type === 'fileChange' || item.type === 'tool')
    && (item.status === 'inProgress' || item.status === 'pending')
}

function labelOf(item: ChatTranscriptItem): string {
  return item.type === 'tool' ? item.label : item.type === 'command' ? item.command : ''
}

function kindOf(item: ChatTranscriptItem): string {
  return item.type === 'command' ? 'execute' : 'other'
}

/** The ACP stop reason in the transcript's vocabulary. */
export function cursorTurnEnd(stopReason: string): TurnEnd {
  if (stopReason === 'cancelled' || stopReason === 'canceled') return { status: 'interrupted' }
  if (stopReason === 'refusal') return { status: 'failed', error: 'Cursor refused the request.' }
  if (stopReason === 'max_tokens') return { status: 'failed', error: 'Cursor stopped at the model output limit.' }
  return { status: 'completed' }
}
