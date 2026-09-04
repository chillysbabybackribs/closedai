import { ClaudeBackgroundTasks } from './claude-background-tasks.js'
import type { ChatTranscriptItem } from '../../shared/chat.js'
import type { ContextUsage } from '../chat-context/context-compaction.js'
import { claudeRateLimitSignal, type ClaudeRateLimitSignal } from '../chat-context/plan-usage.js'
import type { TranscriptOp, TurnEnd } from '../chat-transcript-ops.js'
import {
  recordOf,
  stringOf,
  toolResultItem,
  toolUseItem,
  type DisplayScreenshot,
  type ToolUse
} from './claude-tool-items.js'

export type { TranscriptOp, TurnEnd } from '../chat-transcript-ops.js'

// Pure translation from the Claude Agent SDK's message stream to transcript operations, so the
// service only applies ops and the same code replays stored sessions. Stream contracts this
// relies on (SDK 0.3.258, includePartialMessages: true, verified live 2026-09-02):
// - `system`/`init` carries the session id and resolved model; it repeats on resume.
// - text / thinking / tool_use blocks arrive as content_block_start → *_delta → *_stop, then
//   the whole `assistant` message restates them. Restated blocks must land on the streamed
//   item's id, so they are matched by content (exact, then prefix) before a new id is minted.
// - tool_use inputs stream as partial_json and parse only at content_block_stop; `user`
//   messages carry the matching tool_result blocks keyed by tool_use id.
// - `result` closes the turn; a non-success subtype, an is_error flag, or an aborted
//   terminal_reason decides whether the turn completed, failed, or was stopped by the user.

export type ClaudeTranslation = {
  ops: TranscriptOp[]
  sessionId?: string
  model?: string
  turnEnd?: TurnEnd
  contextUsage?: ContextUsage
  /** The one plan window a mid-turn rate-limit event moved. */
  rateLimit?: ClaudeRateLimitSignal
}

export type ClaudeTranslatorOptions = {
  turnId: string | null
  cwd: string
  displayScreenshot: DisplayScreenshot
  /** Replaying a stored session: user text becomes transcript items and opens a new turn. */
  backgroundTasks?: ClaudeBackgroundTasks
  replay?: boolean
}

type StreamBlock = { id: string; kind: 'text' | 'thinking' | 'tool'; text: string; partialJson: string }

const ABORT_REASONS = new Set(['aborted_streaming', 'aborted_tools'])

export class ClaudeTurnTranslator {
  private readonly backgroundTasks: ClaudeBackgroundTasks
  private turnId: string | null
  private readonly blocks = new Map<number, StreamBlock>()
  private readonly tools = new Map<string, ChatTranscriptItem>()
  /** SDK tool names by tool_use id, so a call re-derived with full input keeps its exact tool. */
  private readonly toolNames = new Map<string, string>()
  private readonly settledIds = new Map<string, string>()
  private messageCount = 0
  private messageKey = 'm0'
  private resolvedModel: string | null = null
  private pendingError: string | null = null
  private lastPromptTokens: number | null = null

  constructor(private readonly options: ClaudeTranslatorOptions) {
    this.backgroundTasks = options.backgroundTasks ?? new ClaudeBackgroundTasks()
    this.turnId = options.turnId
  }

  handle(raw: unknown): ClaudeTranslation {
    const message = recordOf(raw)
    switch (message.type) {
      case 'system':
        return this.handleSystem(message)
      case 'stream_event':
        return this.handleStreamEvent(recordOf(message.event))
      case 'assistant':
        return this.handleAssistant(message)
      case 'user':
        return this.handleUser(message)
      case 'rate_limit_event': {
        const info = recordOf(message.rate_limit_info)
        if (info.status === 'rejected') this.pendingError = `Claude usage limit reached.${resetNote(info.resetsAt)}`
        const rateLimit = claudeRateLimitSignal(info)
        return rateLimit ? { ops: [], rateLimit } : { ops: [] }
      }
      case 'auth_status':
        return typeof message.error === 'string' && message.error
          ? { ops: [notice(`Claude sign-in problem: ${message.error}`, 'error')] }
          : { ops: [] }
      case 'result':
        return this.handleResult(message)
      default:
        return { ops: [] }
    }
  }

  private handleSystem(message: Record<string, unknown>): ClaudeTranslation {
    switch (message.subtype) {
      case 'init':
        if (typeof message.model === 'string') this.resolvedModel = message.model
        return {
          ops: [],
          ...(typeof message.session_id === 'string' ? { sessionId: message.session_id } : {}),
          ...(this.resolvedModel ? { model: this.resolvedModel } : {})
        }
      case 'compact_boundary':
        return { ops: [notice('Conversation context compacted', 'info')] }
      case 'model_refusal_fallback':
        return { ops: [notice(`${stringOf(message.original_model)} declined this request; continued on ${stringOf(message.fallback_model)}`, 'info')] }
      case 'permission_denied':
        return { ops: [notice(`${stringOf(message.tool_name)} was not allowed: ${stringOf(message.message)}`, 'error')] }
      case 'task_started':
      case 'task_progress':
      case 'task_notification': {
        const item = this.backgroundTasks.handle(message, this.turnId, this.options.replay)
        return { ops: item ? [{ type: 'item', item }] : [] }
      }
      default:
        return { ops: [] }
    }
  }

  private handleStreamEvent(event: Record<string, unknown>): ClaudeTranslation {
    switch (event.type) {
      case 'message_start': {
        this.messageCount += 1
        const message = recordOf(event.message)
        this.messageKey = `m${this.messageCount}`
        this.blocks.clear()
        const usage = recordOf(message.usage)
        this.lastPromptTokens = numberOf(usage.input_tokens) + numberOf(usage.cache_read_input_tokens) + numberOf(usage.cache_creation_input_tokens)
        return { ops: [] }
      }
      case 'content_block_start':
        return this.handleBlockStart(Number(event.index ?? 0), recordOf(event.content_block))
      case 'content_block_delta':
        return this.handleBlockDelta(Number(event.index ?? 0), recordOf(event.delta))
      case 'content_block_stop':
        return this.handleBlockStop(Number(event.index ?? 0))
      default:
        return { ops: [] }
    }
  }

  private handleBlockStart(index: number, block: Record<string, unknown>): ClaudeTranslation {
    if (block.type === 'text' || block.type === 'thinking') {
      const id = `${this.turnKey()}:${this.messageKey}:b${index}`
      this.blocks.set(index, { id, kind: block.type, text: '', partialJson: '' })
      return { ops: [{ type: 'item', item: this.textItem(block.type, id, '', true) }] }
    }
    if (block.type === 'tool_use' && typeof block.id === 'string') {
      this.blocks.set(index, { id: block.id, kind: 'tool', text: '', partialJson: '' })
      return { ops: this.startTool({ id: block.id, name: stringOf(block.name) || 'tool', input: recordOf(block.input) }) }
    }
    return { ops: [] }
  }

  private handleBlockDelta(index: number, delta: Record<string, unknown>): ClaudeTranslation {
    const block = this.blocks.get(index)
    if (!block) return { ops: [] }
    if (block.kind === 'text' && typeof delta.text === 'string') {
      block.text += delta.text
      return { ops: [{ type: 'delta', itemId: block.id, field: 'text', delta: delta.text }] }
    }
    if (block.kind === 'thinking' && typeof delta.thinking === 'string') {
      block.text += delta.thinking
      return { ops: [{ type: 'delta', itemId: block.id, field: 'text', delta: delta.thinking }] }
    }
    if (block.kind === 'tool' && typeof delta.partial_json === 'string') block.partialJson += delta.partial_json
    return { ops: [] }
  }

  private handleBlockStop(index: number): ClaudeTranslation {
    const block = this.blocks.get(index)
    if (!block) return { ops: [] }
    if (block.kind === 'tool') {
      const tool = this.tools.get(block.id)
      const input = parseJson(block.partialJson)
      if (!tool || Object.keys(input).length === 0) return { ops: [] }
      return { ops: this.enrichTool(block.id, input) }
    }
    this.settledIds.set(`${block.kind} ${block.text}`, block.id)
    return { ops: [{ type: 'item', item: this.textItem(block.kind, block.id, block.text, false) }] }
  }

  /** The restated message: complete tool inputs, and text or thinking not seen as a stream. */
  private handleAssistant(message: Record<string, unknown>): ClaudeTranslation {
    const body = recordOf(message.message)
    if (typeof message.error === 'string' && message.error) {
      this.pendingError = `Claude request failed: ${message.error.replaceAll('_', ' ')}`
    }
    const providerId = safeId(stringOf(message.uuid) || stringOf(body.id) || 'message')
    const ops: TranscriptOp[] = []
    const content = Array.isArray(body.content) ? body.content : []
    content.forEach((raw, index) => {
      const block = recordOf(raw)
      if (block.type === 'tool_use' && typeof block.id === 'string') {
        ops.push(...this.startTool({ id: block.id, name: stringOf(block.name) || 'tool', input: recordOf(block.input) }))
        ops.push(...this.enrichTool(block.id, recordOf(block.input)))
        return
      }
      const kind = block.type === 'text' ? 'text' : block.type === 'thinking' ? 'thinking' : null
      const text = kind === 'text' ? stringOf(block.text) : stringOf(block.thinking)
      if (!kind || !text) return
      const key = `${kind} ${text}`
      let id = this.settledIds.get(key) ?? this.matchStreamed(kind, text)
      if (!id) id = `${this.turnKey()}:${providerId}:${kind[0]}${index}`
      this.settledIds.set(key, id)
      ops.push({ type: 'item', item: this.textItem(kind, id, text, false) })
    })
    return { ops }
  }

  /** Tool results always; user text only when replaying a stored session. */
  private handleUser(message: Record<string, unknown>): ClaudeTranslation {
    const body = recordOf(message.message)
    const content = body.content
    const ops: TranscriptOp[] = []
    const blocks = Array.isArray(content) ? content.map(recordOf) : []
    for (const block of blocks) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
      const item = this.tools.get(block.tool_use_id)
      if (!item) continue
      const updated = toolResultItem(item, { content: block.content, isError: block.is_error === true }, this.options.displayScreenshot)
      this.tools.set(block.tool_use_id, updated)
      ops.push({ type: 'item', item: updated })
    }
    if (ops.length > 0 || !this.options.replay) return { ops }
    const text = typeof content === 'string'
      ? content
      : blocks.flatMap((block) => (block.type === 'text' ? [stringOf(block.text)] : [])).join('\n')
    if (!text.trim() || message.isSynthetic === true) return { ops: [] }
    this.turnId = `turn:${safeId(stringOf(message.uuid) || String(this.messageCount + 1))}`
    this.messageCount += 1
    const images = blocks.filter((block) => block.type === 'image').length
    return {
      ops: [{
        type: 'item',
        item: {
          type: 'user',
          id: `user:${this.turnId}`,
          turnId: this.turnId,
          text: stripContextBlocks(text),
          ...(images ? { attachments: Array.from({ length: images }, (_, i) => ({ id: `${this.turnId}:img${i}`, kind: 'image' as const, name: 'Image' })) } : {})
        }
      }]
    }
  }

  private handleResult(message: Record<string, unknown>): ClaudeTranslation {
    const aborted = ABORT_REASONS.has(stringOf(message.terminal_reason))
    const failed = message.subtype !== 'success' || message.is_error === true
    const ops: TranscriptOp[] = []
    const contextUsage = this.contextUsage(message)
    if (aborted) return { ops, turnEnd: { status: 'interrupted' }, ...(contextUsage ? { contextUsage } : {}) }
    if (!failed) return { ops, turnEnd: { status: 'completed' }, ...(contextUsage ? { contextUsage } : {}) }
    const sdkErrors = Array.isArray(message.errors) ? message.errors.filter((e): e is string => typeof e === 'string' && e.trim().length > 0) : []
    const error =
      this.pendingError ??
      (sdkErrors.length ? sdkErrors.join('\n') : null) ??
      (typeof message.result === 'string' && message.result.trim() ? message.result : null) ??
      `Claude turn ended: ${stringOf(message.subtype) || 'error'}`
    return { ops, turnEnd: { status: 'failed', error }, ...(contextUsage ? { contextUsage } : {}) }
  }

  private startTool(use: ToolUse): TranscriptOp[] {
    if (this.tools.has(use.id)) return []
    const item = toolUseItem(use, this.turnId, this.options.cwd)
    this.tools.set(use.id, item)
    this.toolNames.set(use.id, use.name)
    return [{ type: 'item', item }]
  }

  /** Re-derive the item once the arguments are known; the id is stable so this upserts. */
  private enrichTool(id: string, input: Record<string, unknown>): TranscriptOp[] {
    const current = this.tools.get(id)
    const name = this.toolNames.get(id)
    if (!current || !name || Object.keys(input).length === 0 || !awaitingResult(current)) return []
    const item = toolUseItem({ id, name, input }, this.turnId, this.options.cwd)
    this.tools.set(id, item)
    return [{ type: 'item', item }]
  }

  private textItem(kind: 'text' | 'thinking', id: string, text: string, streaming: boolean): ChatTranscriptItem {
    return kind === 'text'
      ? { type: 'assistant', id, turnId: this.turnId, text, phase: null, streaming }
      : { type: 'reasoning', id, turnId: this.turnId, text, streaming }
  }

  private matchStreamed(kind: 'text' | 'thinking', text: string): string | null {
    let prefix: string | null = null
    for (const block of this.blocks.values()) {
      if (block.kind !== kind) continue
      if (block.text === text) return block.id
      if (!prefix && block.text.length > 0 && (text.startsWith(block.text) || block.text.startsWith(text))) prefix = block.id
    }
    return prefix
  }

  /** Prompt size from the last message_start against the resolved model's window from `result`. */
  private contextUsage(message: Record<string, unknown>): ContextUsage | null {
    if (this.lastPromptTokens === null || this.lastPromptTokens <= 0) return null
    const entries = Object.entries(recordOf(message.modelUsage))
      .map(([model, usage]) => ({ model, window: recordOf(usage).contextWindow }))
      .filter((entry): entry is { model: string; window: number } => typeof entry.window === 'number' && entry.window > 0)
    if (entries.length === 0) return null
    const resolved = this.resolvedModel ? normalizeModelId(this.resolvedModel) : null
    const match = resolved ? entries.find((entry) => normalizeModelId(entry.model) === resolved) : null
    const window = match?.window ?? entries.reduce((widest, entry) => (entry.window > widest.window ? entry : widest)).window
    return { usedTokens: this.lastPromptTokens, contextWindow: window }
  }

  private turnKey(): string {
    return this.turnId ?? 'turn'
  }
}

/** A tool item whose result has not landed yet; a settled one must not regress to in-progress. */
function awaitingResult(item: ChatTranscriptItem): boolean {
  if (item.type === 'command' || item.type === 'fileChange' || item.type === 'tool') return item.status === 'inProgress'
  return item.type === 'plan'
}

function notice(text: string, tone: 'info' | 'error'): TranscriptOp {
  return { type: 'notice', text, tone }
}

function stripContextBlocks(text: string): string {
  return text.replace(/<closedai_context\b[^>]*>[\s\S]*?<\/closedai_context>\s*/g, '').trim()
}

function parseJson(text: string): Record<string, unknown> {
  if (!text.trim()) return {}
  try {
    return recordOf(JSON.parse(text))
  } catch {
    return {}
  }
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 120) || 'message'
}

function normalizeModelId(model: string): string {
  return model.toLowerCase().replace(/\[[^\]]*\]/g, '').replace(/-\d{8}$/, '').trim()
}

function resetNote(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  const date = new Date(value < 10_000_000_000 ? value * 1000 : value)
  return Number.isNaN(date.getTime()) ? '' : ` Resets at ${date.toLocaleString()}.`
}
