import type { ChatTranscriptItem } from '../../shared/chat.js'
import type { TranscriptOp, TurnEnd } from '../chat-transcript-ops.js'
import { recordOf, stringOf } from '../claude/claude-tool-items.js'
import { classifyAntigravityCache } from './antigravity-cache-diagnostics.js'
import { antigravityToolItem, antigravityToolResult, resolveAntigravityTool, type AntigravityServerName } from './antigravity-tool-items.js'

// Pure translation from the `agy` stream-json events of one turn to transcript operations, so
// the session only applies ops. Stream contract this relies on (agy 1.1.24, verified live
// 2026-09-02):
// - Every line is `{"event": <kind>, <kind>: {...}}`: the payload sits under a key named like
//   the discriminator. `init` carries the conversation id (also echoed on every step).
// - `step_update` carries progress: `step_type` user_input | agent_response | tool | checkpoint,
//   `state` ACTIVE → DONE (or ERROR for a failed tool), `step_index` stable per step. Text
//   arrives as `text_delta` on agent_response steps, sometimes only on the DONE half. Tool
//   steps carry `tool_info{name, parameters, output?, error?}`; output only on DONE.
// - `result` closes the turn: `status` SUCCESS | ERROR | CANCELED | INTERRUPTED | INVALID,
//   `response` (the final assistant text), summed `usage`. It arrives a few seconds after the
//   last step. The delta stream is not a reliable transcript: a turn whose response was one
//   word streamed only "\n". So the last assistant item is repaired from `response` on close.
// - Usage carries no context window, so the transcript shows no context gauge.

export type { TranscriptOp, TurnEnd } from '../chat-transcript-ops.js'

export type AntigravityTranslation = {
  ops: TranscriptOp[]
  conversationId?: string
  model?: string
  turnEnd?: TurnEnd
  /** Session should send the empty-success recovery prompt on the live process. */
  requestEmptySuccessRecovery?: boolean
}

export type AntigravityTranslatorOptions = {
  turnId: string
  cwd: string
  /** MCP server names the CLI knows, so `mcp_<server>_<tool>` declarations resolve to their namespace and tool. */
  servers: readonly AntigravityServerName[]
  displayScreenshot: (callId: string) => { dataUrl: string } | null
  /** The registry call id behind the ClosedAI tool the CLI just reported, when the bridge served one. */
  takeCallId: (namespace: string, tool: string) => string | null
  /** When SUCCESS arrives without assistant text, return true to queue one internal recovery turn. */
  requestEmptySuccessRecovery?: () => boolean
  /** Token accounting from the turn, for trace telemetry. */
  onTokenUsage?: (usage: { inputTokens: number; cacheReadTokens?: number; cacheAnomaly: boolean }) => void
}

const INTERRUPTED_STATUSES = new Set(['CANCELED', 'CANCELLED', 'INTERRUPTED'])

export class AntigravityTurnTranslator {
  private readonly tools = new Map<number, ChatTranscriptItem>()
  private readonly texts = new Map<number, string>()
  private lastText: { id: string; text: string } | null = null
  private settled = false
  private emptySuccessRecoveries = 0
  private lastStepUsage: Record<string, unknown> | null = null

  constructor(private readonly options: AntigravityTranslatorOptions) {}

  handle(raw: unknown): AntigravityTranslation {
    const event = recordOf(raw)
    switch (event.event) {
      case 'init': {
        const init = recordOf(event.init)
        return {
          ops: [],
          ...(typeof event.conversation_id === 'string' ? { conversationId: event.conversation_id } : {}),
          ...(typeof init.model === 'string' ? { model: init.model } : {})
        }
      }
      case 'step_update':
        return this.handleStep(recordOf(event.step_update))
      case 'result':
        return this.handleResult(recordOf(event.result))
      default:
        return { ops: [] }
    }
  }

  /** Close every tool still running when the turn ends without the CLI settling it. */
  finish(): TranscriptOp[] {
    if (this.settled) return []
    this.settled = true
    const ops: TranscriptOp[] = []
    for (const [index, item] of this.tools) {
      if (!inProgress(item)) continue
      const closed = antigravityToolResult(item, { output: 'The turn ended before this tool call reported a result.', failed: true })
      this.tools.set(index, closed)
      ops.push({ type: 'item', item: closed })
    }
    if (this.lastText) ops.push({ type: 'item', item: this.assistantItem(this.lastText.id, this.lastText.text, false) })
    return ops
  }

  private handleStep(step: Record<string, unknown>): AntigravityTranslation {
    const usage = recordOf(step.usage)
    if (Object.keys(usage).length > 0) this.lastStepUsage = usage
    const conversationId = typeof step.conversation_id === 'string' ? { conversationId: step.conversation_id } : {}
    const index = typeof step.step_index === 'number' ? step.step_index : -1
    if (index < 0) return { ops: [], ...conversationId }
    if (step.step_type === 'agent_response') return { ops: this.handleText(index, step), ...conversationId }
    if (step.step_type === 'tool') return { ops: this.handleTool(index, step), ...conversationId }
    return { ops: [], ...conversationId }
  }

  private handleText(index: number, step: Record<string, unknown>): TranscriptOp[] {
    const delta = stringOf(step.text_delta)
    const done = step.state === 'DONE'
    const known = this.texts.has(index)
    if (!delta && !known) return []
    const id = `${this.options.turnId}:s${index}`
    const text = (this.texts.get(index) ?? '') + delta
    this.texts.set(index, text)
    this.lastText = { id, text }
    if (!known) return [{ type: 'item', item: this.assistantItem(id, text, !done) }]
    const ops: TranscriptOp[] = delta ? [{ type: 'delta', itemId: id, field: 'text', delta }] : []
    if (done) ops.push({ type: 'item', item: this.assistantItem(id, text, false) })
    return ops
  }

  private handleTool(index: number, step: Record<string, unknown>): TranscriptOp[] {
    const info = recordOf(step.tool_info)
    const name = stringOf(step.tool_name) || stringOf(info.name) || 'tool'
    const parameters = recordOf(info.parameters)
    const id = `${this.options.turnId}:s${index}`
    let item = this.tools.get(index)
    const ops: TranscriptOp[] = []
    if (!item) {
      item = antigravityToolItem({ id, name, parameters }, this.options.turnId, this.options.cwd, this.options.servers)
      this.tools.set(index, item)
      ops.push({ type: 'item', item })
    }
    if (step.state !== 'DONE' && step.state !== 'ERROR') return ops
    if (!inProgress(item)) return ops
    const failed = step.state === 'ERROR'
    const output = stringOf(info.output) || (failed ? describeError(info.error) : '')
    const settled = this.screenshotItem(item, name, parameters, output, failed) ?? antigravityToolResult(item, { output, failed })
    this.tools.set(index, settled)
    ops.push({ type: 'item', item: settled })
    return ops
  }

  /** A ClosedAI capture that the app still holds at full resolution becomes a screenshot row. */
  private screenshotItem(item: ChatTranscriptItem, name: string, parameters: Record<string, unknown>, output: string, failed: boolean): ChatTranscriptItem | null {
    if (failed || item.type !== 'tool') return null
    const resolved = resolveAntigravityTool(name, parameters, this.options.servers)
    if (!resolved.namespace) return null
    const callId = this.options.takeCallId(resolved.namespace, resolved.tool)
    if (resolved.namespace !== 'closedai_ui' || resolved.tool !== 'capture' || !callId) return null
    const action = resolved.parameters.action
    const surface = action === 'app_window' || action === 'browser_page' || action === 'crop' ? action : null
    const imageUrl = this.options.displayScreenshot(callId)?.dataUrl
    if (!surface || !imageUrl) return null
    return { type: 'screenshot', id: item.id, turnId: item.turnId, imageUrl, surface, caption: output.split('\n')[0]?.trim() ?? '' }
  }

  private handleResult(result: Record<string, unknown>): AntigravityTranslation {
    const conversationId = typeof result.conversation_id === 'string' ? { conversationId: result.conversation_id } : {}
    const status = stringOf(result.status) || 'SUCCESS'
    const response = stringOf(result.response)
    const resultUsage = recordOf(result.usage)
    if (Object.keys(resultUsage).length > 0) this.lastStepUsage = resultUsage
    const ops = this.finish()
    if (status === 'SUCCESS') {
      const finalText = response.trim()
      if (!finalText && (!this.lastText || !this.lastText.text.trim())) {
        if (this.emptySuccessRecoveries === 0 && this.tryEmptySuccessRecovery()) {
          this.emptySuccessRecoveries = 1
          this.settled = false
          return { ops, ...conversationId, requestEmptySuccessRecovery: true }
        }
        const message = this.emptySuccessRecoveries > 0
          ? 'Antigravity finished twice without a reply'
          : 'Antigravity finished the turn without a reply'
        ops.push({ type: 'notice', text: message, tone: 'info' })
        this.emitTokenUsage()
        return { ops, ...conversationId, turnEnd: { status: 'completed' } }
      }
      ops.push(...this.repairFinalText(response))
      this.emitTokenUsage()
      return { ops, ...conversationId, turnEnd: { status: 'completed' } }
    }
    if (INTERRUPTED_STATUSES.has(status)) {
      this.emitTokenUsage()
      return { ops, ...conversationId, turnEnd: { status: 'interrupted' } }
    }
    const error = stringOf(result.error) || `Antigravity turn ended: ${status.toLowerCase()}`
    this.emitTokenUsage()
    return { ops, ...conversationId, turnEnd: { status: 'failed', error } }
  }

  private tryEmptySuccessRecovery(): boolean {
    try {
      return this.options.requestEmptySuccessRecovery?.() === true
    } catch {
      return false
    }
  }

  private emitTokenUsage(): void {
    const usage = this.lastStepUsage
    if (!usage || !this.options.onTokenUsage) return
    const inputTokens = usage.input_tokens
    if (typeof inputTokens !== 'number' || !Number.isFinite(inputTokens) || inputTokens < 0) return
    const cacheRead = usage.cache_read_tokens
    const cacheReadTokens = typeof cacheRead === 'number' && Number.isFinite(cacheRead) && cacheRead >= 0 ? cacheRead : undefined
    const { anomaly } = classifyAntigravityCache({ inputTokens, cacheReadTokens })
    this.options.onTokenUsage({ inputTokens, cacheReadTokens, cacheAnomaly: anomaly })
  }

  /** `result.response` is the final assistant text; trust it over a delta stream that came up short. */
  private repairFinalText(response: string): TranscriptOp[] {
    if (!response.trim()) return this.lastText ? [] : []
    if (!this.lastText) return [{ type: 'item', item: this.assistantItem(`${this.options.turnId}:final`, response, false) }]
    if (this.lastText.text.trim() === response.trim() || this.lastText.text.length >= response.length) return []
    return [{ type: 'item', item: this.assistantItem(this.lastText.id, response, false) }]
  }

  private assistantItem(id: string, text: string, streaming: boolean): ChatTranscriptItem {
    return { type: 'assistant', id, turnId: this.options.turnId, text, phase: null, streaming }
  }
}

function inProgress(item: ChatTranscriptItem): boolean {
  return (item.type === 'command' || item.type === 'fileChange' || item.type === 'tool') && item.status === 'inProgress'
}

function describeError(error: unknown): string {
  if (typeof error === 'string') return error
  const record = recordOf(error)
  const message = stringOf(record.message) || stringOf(record.details) || stringOf(record.type)
  if (message) return message
  try {
    return error === undefined ? 'The tool call failed' : JSON.stringify(error)
  } catch {
    return 'The tool call failed'
  }
}
