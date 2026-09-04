import { ClaudeBackgroundTasks } from './claude-background-tasks.js'
import { randomUUID } from 'node:crypto'
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ContextUsage } from '../chat-context/context-compaction.js'
import type { ClaudeRateLimitSignal } from '../chat-context/plan-usage.js'
import type { ChatPlanUsage } from '../../shared/chat.js'
import { claudeTurnId } from './claude-ids.js'
import { claudeQueryOptions } from './claude-options.js'
import { ClaudeReadLedger, type LedgerSkip } from './claude-read-ledger.js'
import { ClaudeRuntime } from './claude-runtime.js'
import type { ClaudeSdk } from './claude-sdk.js'
import { ClaudeTurnTranslator, type TranscriptOp, type TurnEnd } from './claude-stream.js'
import type { DisplayScreenshot } from './claude-tool-items.js'
import { traceLog, type TraceScope } from '../trace/trace-log.js'
import { summarizeClaudeMessage } from '../trace/summaries.js'

// The chat pane's one Claude thread: which stored session it continues, the live process when
// there is one, and the turn that process is running. The process is spawned on demand with
// `resume` pointing at the session, kept across turns, and closed after a quiet spell so an
// idle chat holds no CLI open; the next turn resumes the same session in a fresh process.

export type ClaudeSessionDeps = {
  sdk: ClaudeSdk
  cwd: string
  mcpServers: () => NonNullable<Options['mcpServers']>
  systemPromptAppend: string
  displayScreenshot: DisplayScreenshot
  apply: (op: TranscriptOp) => void
  onTurn: (turnId: string | null) => void
  onSessionId: (sessionId: string) => void
  onTurnEnd: (turnId: string, end: TurnEnd) => void
  onContextUsage: (usage: ContextUsage) => void
  /** One plan window moved mid-turn; the full reading still comes from `planUsage`. */
  onPlanUsageSignal: (signal: ClaudeRateLimitSignal) => void
  /** When set, every SDK message in either direction is recorded in the turn trace. */
  traceScope?: () => TraceScope
  idleMs?: number
}

const DEFAULT_IDLE_MS = 15 * 60 * 1000

export class ClaudeSession {
  /** The SDK session this thread continues; set from the first init and used for `resume`. */
  sessionId: string | null = null
  model: string | null = null
  effort: string | null = null
  adaptiveThinking = true
  activeTurnId: string | null = null
  private runtime: ClaudeRuntime | null = null
  private runtimeThinking = true
  private readonly backgroundTasks = new ClaudeBackgroundTasks()
  private readonly readLedger = new ClaudeReadLedger((skip) => this.traceSkip(skip))
  private translator: ClaudeTurnTranslator | null = null
  private idleTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: ClaudeSessionDeps) {}

  get live(): boolean {
    return this.runtime !== null && !this.runtime.closed
  }

  /** The live process, spawning one (resuming the session when there is one) if needed. */
  ensureRuntime(): ClaudeRuntime {
    if (this.runtime && !this.runtime.closed) return this.runtime
    const id = randomUUID()
    const options = claudeQueryOptions({
      cwd: this.deps.cwd,
      model: this.model,
      effort: this.effort,
      adaptiveThinking: this.adaptiveThinking,
      resume: this.sessionId,
      runtimeId: id,
      mcpServers: this.deps.mcpServers(),
      systemPromptAppend: this.deps.systemPromptAppend,
      hooks: this.readLedger.hooks(),
      stderr: (data) => { const text = data.trim(); if (text) console.warn('[claude]', text) }
    })
    const runtime = new ClaudeRuntime(this.deps.sdk, id, options, {
      onMessage: (message) => { if (this.runtime === runtime) this.onMessage(message) },
      onEnd: (error) => { if (this.runtime === runtime) this.onEnd(error) }
    })
    this.runtime = runtime
    this.runtimeThinking = this.adaptiveThinking
    return runtime
  }

  /** Start a turn: returns its id once the message is queued on the live process. */
  send(message: SDKUserMessage): string {
    if (this.activeTurnId) throw new Error('A Claude turn is already running')
    const runtime = this.ensureRuntime()
    this.clearIdleTimer()
    const turnId = claudeTurnId()
    this.beginTurn(turnId)
    const outgoing = { ...message, session_id: this.sessionId ?? message.session_id }
    runtime.push(outgoing)
    this.trace('out', outgoing)
    return turnId
  }

  async interrupt(): Promise<void> {
    if (!this.activeTurnId || !this.runtime || this.runtime.closed) return
    await this.runtime.interrupt()
  }

  /**
   * The account's plan windows from the live process. Null when there is none: reading usage
   * is not worth a spawn, so an idle chat keeps showing its last reading instead.
   */
  async planUsage(): Promise<ChatPlanUsage | null> {
    const runtime = this.runtime
    if (!runtime || runtime.closed) return null
    return runtime.planUsage()
  }

  async setModel(model: string | null, adaptiveThinking: boolean): Promise<void> {
    this.model = model
    this.adaptiveThinking = adaptiveThinking
    if (!this.runtime || this.runtime.closed) return
    // Thinking display is a spawn-time option; a model that needs a different one gets a
    // fresh process on the next turn (never mid-turn) instead of a silently wrong setting.
    if (this.runtimeThinking !== adaptiveThinking && !this.activeTurnId) {
      await this.retire()
      return
    }
    await this.runtime.setModel(model)
  }

  async setEffort(effort: string | null): Promise<void> {
    this.effort = effort
    if (!this.runtime || this.runtime.closed) return
    await this.runtime.setEffort(effort as Options['effort'] | null)
  }

  /** Close the live process but keep the session id, so the next turn resumes it. */
  async retire(): Promise<void> {
    this.clearIdleTimer()
    const runtime = this.runtime
    this.runtime = null
    for (const item of this.backgroundTasks.stop()) this.deps.apply({ type: 'item', item })
    if (this.activeTurnId) this.endTurn({ status: 'failed', error: 'Claude Code was stopped before the turn completed' })
    if (runtime) await runtime.close()
  }

  /** Forget the session entirely; the next turn starts a new one. */
  async reset(): Promise<void> {
    await this.retire()
    this.sessionId = null
  }

  /** Continue a stored session (chat history): any live process belongs to the old one. */
  async adopt(sessionId: string): Promise<void> {
    await this.retire()
    this.sessionId = sessionId
  }

  private trace(direction: 'in' | 'out', message: SDKMessage | SDKUserMessage): void {
    if (!this.deps.traceScope) return
    traceLog.record(this.deps.traceScope(), {
      kind: 'raw',
      label: direction === 'in' ? 'claude.in' : 'claude.out',
      summary: direction === 'in' ? summarizeClaudeMessage(message as SDKMessage) : 'user message',
      detail: message,
      direction
    })
  }

  private onMessage(message: SDKMessage): void {
    this.trace('in', message)
    // The CLI can start a turn by itself when a backgrounded task settles; mint one so its
    // output lands in the transcript instead of being dropped.
    if (!this.translator && (message.type === 'stream_event' || message.type === 'assistant')) {
      this.beginTurn(claudeTurnId())
    }
    const translator = this.translator ?? new ClaudeTurnTranslator({ backgroundTasks: this.backgroundTasks, turnId: null, cwd: this.deps.cwd, displayScreenshot: this.deps.displayScreenshot })
    const translation = translator.handle(message)
    if (translation.sessionId && translation.sessionId !== this.sessionId) {
      this.sessionId = translation.sessionId
      this.deps.onSessionId(translation.sessionId)
    }
    for (const op of translation.ops) this.deps.apply(op)
    if (translation.contextUsage) this.deps.onContextUsage(translation.contextUsage)
    if (translation.rateLimit) this.deps.onPlanUsageSignal(translation.rateLimit)
    if (translation.turnEnd) this.endTurn(translation.turnEnd)
    if (this.backgroundTasks.running) this.clearIdleTimer()
    else if (!this.activeTurnId) this.scheduleIdleClose()
  }

  private onEnd(error: unknown): void {
    this.runtime = null
    for (const item of this.backgroundTasks.stop()) this.deps.apply({ type: 'item', item })
    this.clearIdleTimer()
    if (this.activeTurnId) {
      const detail = error instanceof Error ? error.message : error ? String(error) : null
      this.endTurn({ status: 'failed', error: detail ? `Claude Code stopped: ${detail}` : 'Claude Code stopped before the turn completed' })
    }
  }

  private traceSkip(skip: LedgerSkip): void {
    if (!this.deps.traceScope) return
    const what = skip.verdict === 'deny' ? 'denied' : 'narrowed'
    traceLog.record(this.deps.traceScope(), {
      kind: 'event',
      label: 'claude.read-ledger',
      summary: `${skip.tool} ${what}: ${skip.path}${skip.lines ? ` (${skip.lines === Number.POSITIVE_INFINITY ? 'all' : skip.lines} lines already in context)` : ''}`,
      detail: skip
    })
  }

  private beginTurn(turnId: string): void {
    this.activeTurnId = turnId
    this.readLedger.reset()
    this.translator = new ClaudeTurnTranslator({ backgroundTasks: this.backgroundTasks, turnId, cwd: this.deps.cwd, displayScreenshot: this.deps.displayScreenshot })
    this.deps.onTurn(turnId)
  }

  private endTurn(end: TurnEnd): void {
    const turnId = this.activeTurnId
    const runtime = this.runtime
    this.activeTurnId = null
    this.translator = null
    if (turnId) this.deps.onTurnEnd(turnId, end)
    this.deps.onTurn(null)
    if (runtime && !runtime.closed) {
      void runtime.contextUsage().then((usage) => {
        if (usage && this.runtime === runtime) this.deps.onContextUsage(usage)
      })
    }
    this.scheduleIdleClose()
  }

  private scheduleIdleClose(): void {
    this.clearIdleTimer()
    if (!this.runtime || this.backgroundTasks.running) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (!this.activeTurnId) void this.retire()
    }, this.deps.idleMs ?? DEFAULT_IDLE_MS)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }
}
