import { randomUUID } from 'node:crypto'
import { antigravityTurnLine } from './antigravity-cli.js'
import { AntigravityProcess } from './antigravity-process.js'
import { AntigravityTurnTranslator, type TranscriptOp, type TurnEnd } from './antigravity-stream.js'
import type { AntigravityServerName } from './antigravity-tool-items.js'

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
  idleMs?: number
}

const DEFAULT_IDLE_MS = 15 * 60 * 1000

export class AntigravitySession {
  /** The CLI conversation this thread continues; set from the first init and used to resume. */
  conversationId: string | null = null
  activeTurnId: string | null = null
  private process: AntigravityProcess | null = null
  private translator: AntigravityTurnTranslator | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private stopping = false

  constructor(private readonly deps: AntigravitySessionDeps) {}

  get live(): boolean {
    return this.process?.alive === true
  }

  /** Start a turn: returns its id once the message is on the live process's stdin. */
  send(content: string): string {
    if (this.activeTurnId) throw new Error('An Antigravity turn is already running')
    const process = this.ensureProcess()
    this.clearIdleTimer()
    const turnId = `agy-turn-${randomUUID()}`
    this.activeTurnId = turnId
    this.translator = new AntigravityTurnTranslator({
      turnId,
      cwd: this.deps.cwd,
      servers: this.deps.servers(),
      displayScreenshot: this.deps.displayScreenshot,
      takeCallId: (namespace, tool) => this.deps.takeCallId(this.conversationId, namespace, tool)
    })
    this.deps.onTurn(turnId)
    try {
      process.write(antigravityTurnLine(content))
    } catch (error) {
      this.endTurn({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
      throw error
    }
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

  private onEvent(raw: unknown): void {
    const translator = this.translator
    if (!translator) return
    const translation = translator.handle(raw)
    if (translation.conversationId && translation.conversationId !== this.conversationId) {
      this.conversationId = translation.conversationId
      this.deps.onConversationId(translation.conversationId)
    }
    for (const op of translation.ops) this.deps.apply(op)
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
