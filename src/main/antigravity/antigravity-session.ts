import { antigravityTurnLine } from './antigravity-cli.js'
import { antigravityTurnId } from './antigravity-ids.js'
import { AntigravityProcess } from './antigravity-process.js'
import { ANTIGRAVITY_EMPTY_SUCCESS_RECOVERY_PROMPT } from './antigravity-runtime-prompts.js'
import { AntigravityTurnTranslator, type TranscriptOp, type TurnEnd } from './antigravity-stream.js'
import type { AntigravityServerName } from './antigravity-tool-items.js'
import { IdleProcessGuard } from '../idle-process-guard.js'
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

export class AntigravitySession {
  /** The CLI conversation this thread continues; set from the first init and used to resume. */
  conversationId: string | null = null
  activeTurnId: string | null = null
  /** Transcript summary injected on the next turn after compaction dropped the CLI handle. */
  pendingSeed: string | null = null
  private process: AntigravityProcess | null = null
  private translator: AntigravityTurnTranslator | null = null
  private readonly idleGuard: IdleProcessGuard
  private stopping = false

  constructor(private readonly deps: AntigravitySessionDeps) {
    this.idleGuard = new IdleProcessGuard(
      () => { if (!this.activeTurnId) void this.retire() },
      deps.idleMs
    )
  }

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
    this.beginUserTurn(process, turnId, content)
    return turnId
  }

  /**
   * Pause the running turn. The protocol has no interrupt, so a turn the CLI is already answering
   * ends by killing the process; the conversation id survives and the next turn resumes it.
   */
  async interrupt(): Promise<void> {
    if (!this.activeTurnId) return
    if (!this.process) return
    this.stopping = true
    await this.retire()
  }

  /** Close the live process but keep the conversation id, so the next turn resumes it. */
  async retire(): Promise<void> {
    this.clearIdleTimer()
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

  private onExit(detail: string, signal: NodeJS.Signals | null): void {
    this.process = null
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
    this.idleGuard.schedule(Boolean(this.process))
  }

  private clearIdleTimer(): void {
    this.idleGuard.clear()
  }
}
