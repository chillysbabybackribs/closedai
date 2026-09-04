import { antigravityTurnLine } from './antigravity-cli.js'
import { antigravityTurnId } from './antigravity-ids.js'
import { AntigravityProcess } from './antigravity-process.js'
import {
  ANTIGRAVITY_EMPTY_SUCCESS_RECOVERY_PROMPT,
  ANTIGRAVITY_MCP_PRIMER_PROMPT
} from './antigravity-runtime-prompts.js'
import { AntigravityTurnTranslator, type TranscriptOp, type TurnEnd } from './antigravity-stream.js'
import type { AntigravityServerName } from './antigravity-tool-items.js'
import { traceLog, type TraceScope } from '../trace/trace-log.js'
import { summarizeAntigravityEvent } from '../trace/summaries.js'

// The chat pane's one Antigravity thread: which CLI conversation it continues, the live process
// when there is one, and the turn that process is running. The process is spawned on demand
// (with `--conversation` when the thread continues a stored conversation), kept across turns,
// and closed after a quiet spell so an idle chat holds no CLI open; the next turn resumes the
// same conversation in a fresh process. Model changes also take a fresh process, since the
// model is a spawn-time flag.

export type AntigravitySessionDeps = {
  cwd: string
  binary: () => string
  /** argv for a process on this thread; `resume` is the conversation to continue. */
  spawnArgs: (resume: string | null) => string[]
  servers: () => AntigravityServerName[]
  displayScreenshot: (callId: string) => { dataUrl: string } | null
  takeCallId: (conversationId: string | null, namespace: string, tool: string) => string | null
  apply: (op: TranscriptOp) => void
  onTurn: (turnId: string | null) => void
  onConversationId: (conversationId: string) => void
  onTurnEnd: (turnId: string, end: TurnEnd) => void
  /** When set, every stream-json line in either direction is recorded in the turn trace. */
  traceScope?: () => TraceScope
  idleMs?: number
}

const DEFAULT_IDLE_MS = 15 * 60 * 1000

export class AntigravitySession {
  /** The CLI conversation this thread continues; set from the first init and used to resume. */
  conversationId: string | null = null
  activeTurnId: string | null = null
  /** Transcript summary injected on the next turn after compaction dropped the CLI handle. */
  pendingSeed: string | null = null
  private process: AntigravityProcess | null = null
  private translator: AntigravityTurnTranslator | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private stopping = false
  private priming = false
  private queuedTurn: { turnId: string; content: string } | null = null

  constructor(private readonly deps: AntigravitySessionDeps) {}

  get live(): boolean {
    return this.process?.alive === true
  }

  /** Start a turn: returns its id once the message is on the live process's stdin. */
  send(content: string): string {
    if (this.activeTurnId) throw new Error('An Antigravity turn is already running')
    this.clearIdleTimer()
    const turnId = antigravityTurnId()
    this.activeTurnId = turnId
    this.deps.onTurn(turnId)
    const process = this.ensureProcess()
    if (this.priming) {
      this.queuedTurn = { turnId, content }
      return turnId
    }
    this.beginUserTurn(process, turnId, content)
    return turnId
  }

  /** Stop the running turn: the protocol has no interrupt, so the process is killed and the conversation resumes later. */
  async interrupt(): Promise<void> {
    if (!this.activeTurnId || !this.process) return
    this.stopping = true
    await this.retire()
  }

  /** Close the live process but keep the conversation id, so the next turn resumes it. */
  async retire(): Promise<void> {
    this.clearIdleTimer()
    this.priming = false
    this.queuedTurn = null
    const process = this.process
    this.process = null
    if (this.activeTurnId) {
      this.endTurn(this.stopping ? { status: 'interrupted' } : { status: 'failed', error: 'Antigravity was stopped before the turn completed' })
    }
    this.stopping = false
    if (process) await process.terminate()
  }

  /** Forget the conversation entirely; the next turn starts a new one. */
  async reset(): Promise<void> {
    await this.retire()
    this.conversationId = null
    this.pendingSeed = null
  }

  /** Drop the CLI conversation handle and seed the next turn from a summary instead. */
  async compact(seed: string): Promise<void> {
    await this.retire()
    this.conversationId = null
    this.pendingSeed = seed
  }

  /** Consume the compaction seed exactly once, when the next turn is sent. */
  takePendingSeed(): string | null {
    const seed = this.pendingSeed
    this.pendingSeed = null
    return seed
  }

  /** Continue a stored conversation (chat history): any live process belongs to the old one. */
  async adopt(conversationId: string): Promise<void> {
    await this.retire()
    this.conversationId = conversationId
  }

  private ensureProcess(): AntigravityProcess {
    if (this.process?.alive) return this.process
    const process = new AntigravityProcess({
      binary: this.deps.binary(),
      args: this.deps.spawnArgs(this.conversationId),
      cwd: this.deps.cwd,
      onEvent: (raw) => { if (this.process === process) this.onEvent(raw) },
      onExit: (info) => { if (this.process === process) this.onExit(info.stderr, info.signal) },
      onSpawnError: (message) => { if (this.process === process) this.onExit(message, null) }
    })
    this.process = process
    this.priming = true
    process.write(antigravityTurnLine(ANTIGRAVITY_MCP_PRIMER_PROMPT))
    this.trace('out', 'mcp primer', ANTIGRAVITY_MCP_PRIMER_PROMPT)
    return process
  }

  private beginUserTurn(process: AntigravityProcess, turnId: string, content: string): void {
    this.translator = this.createTranslator(turnId)
    try {
      process.write(antigravityTurnLine(content))
      this.trace('out', 'user turn', content)
    } catch (error) {
      this.endTurn({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  private createTranslator(turnId: string): AntigravityTurnTranslator {
    return new AntigravityTurnTranslator({
      turnId,
      cwd: this.deps.cwd,
      servers: this.deps.servers(),
      displayScreenshot: this.deps.displayScreenshot,
      takeCallId: (namespace, tool) => this.deps.takeCallId(this.conversationId, namespace, tool),
      requestEmptySuccessRecovery: () => this.requestEmptySuccessRecovery(),
      onTokenUsage: (usage) => {
        if (!this.deps.traceScope) return
        traceLog.record(this.deps.traceScope(), {
          kind: 'note',
          label: 'agy.usage',
          summary: usage.cacheAnomaly ? 'cache anomaly (0 cache reads on large prompt)' : 'token usage',
          detail: usage
        })
      }
    })
  }

  private requestEmptySuccessRecovery(): boolean {
    const process = this.process
    if (!process?.alive) return false
    try {
      process.write(antigravityTurnLine(ANTIGRAVITY_EMPTY_SUCCESS_RECOVERY_PROMPT))
      this.trace('out', 'empty-success recovery', ANTIGRAVITY_EMPTY_SUCCESS_RECOVERY_PROMPT)
      return true
    } catch {
      return false
    }
  }

  private trace(direction: 'in' | 'out', summary: string, detail: unknown): void {
    if (!this.deps.traceScope) return
    traceLog.record(this.deps.traceScope(), { kind: 'raw', label: direction === 'in' ? 'agy.in' : 'agy.out', summary, detail, direction })
  }

  private onEvent(raw: unknown): void {
    this.trace('in', summarizeAntigravityEvent(raw), raw)
    if (this.priming) {
      this.captureConversationId(raw)
      if (isResultEvent(raw)) {
        this.priming = false
        const queued = this.queuedTurn
        this.queuedTurn = null
        const process = this.process
        if (queued && process?.alive) this.beginUserTurn(process, queued.turnId, queued.content)
      }
      return
    }
    const translator = this.translator
    if (!translator) return
    const translation = translator.handle(raw)
    if (translation.conversationId && translation.conversationId !== this.conversationId) {
      this.conversationId = translation.conversationId
      this.deps.onConversationId(translation.conversationId)
    }
    for (const op of translation.ops) this.deps.apply(op)
    if (translation.requestEmptySuccessRecovery) return
    if (translation.turnEnd) {
      this.endTurn(translation.turnEnd)
      this.scheduleIdleClose()
    }
  }

  private captureConversationId(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) return
    const record = raw as Record<string, unknown>
    if (record.event === 'result') {
      const result = record.result as Record<string, unknown> | undefined
      const id = typeof result?.conversation_id === 'string' ? result.conversation_id : null
      if (id) this.noteConversationId(id)
      return
    }
    const id = typeof record.conversation_id === 'string' ? record.conversation_id : null
    if (id) this.noteConversationId(id)
  }

  private noteConversationId(conversationId: string): void {
    if (conversationId === this.conversationId) return
    this.conversationId = conversationId
    this.deps.onConversationId(conversationId)
  }

  private onExit(detail: string, signal: NodeJS.Signals | null): void {
    this.process = null
    this.priming = false
    this.queuedTurn = null
    this.clearIdleTimer()
    if (!this.activeTurnId) return
    const error = detail ? `Antigravity stopped: ${detail}` : `Antigravity stopped before the turn completed${signal ? ` (${signal})` : ''}`
    this.endTurn(this.stopping ? { status: 'interrupted' } : { status: 'failed', error })
    this.stopping = false
  }

  private endTurn(end: TurnEnd): void {
    const turnId = this.activeTurnId
    const translator = this.translator
    this.activeTurnId = null
    this.translator = null
    if (translator) for (const op of translator.finish()) this.deps.apply(op)
    if (turnId) this.deps.onTurnEnd(turnId, end)
    this.deps.onTurn(null)
  }

  private scheduleIdleClose(): void {
    this.clearIdleTimer()
    if (!this.process) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (!this.activeTurnId) void this.retire()
    }, this.deps.idleMs ?? DEFAULT_IDLE_MS)
    this.idleTimer.unref?.()
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }
}

function isResultEvent(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>).event === 'result'
}
