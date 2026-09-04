import {
  CursorAcpClient,
  type AcpCapabilities, type AcpMcpServer, type AcpPromptBlock, type AcpSessionSetup
} from './cursor-acp.js'
import { cursorTurnId } from './cursor-ids.js'
import { CursorTurnTranslator, cursorTurnEnd, type TranscriptOp, type TurnEnd } from './cursor-stream.js'
import type { ChatTranscriptItem } from '../../shared/chat.js'
import { IdleProcessGuard } from '../idle-process-guard.js'
import type { TraceScope } from '../trace/trace-log.js'

// The chat pane's one Cursor thread: which ACP session it continues, the live `cursor-agent acp`
// process when there is one, and the turn that process is running.
//
// Unlike the `agy` adapter, the process is not per conversation and the protocol has a real
// interrupt: `session/cancel` ends the turn and leaves the session usable, and `session/load`
// reopens a session the agent still holds. So an idle chat closes the process and the next turn
// reopens the same session in a fresh one — and a model change is an in-session
// `session/set_model`, not a respawn.

export type CursorSessionDeps = {
  cwd: string
  mcpServers: () => AcpMcpServer[]
  /** The ACP model id to select on a fresh session, or null for the agent's own default. */
  modelId: () => string | null
  apply: (op: TranscriptOp) => void
  onTurn: (turnId: string | null) => void
  onSessionId: (sessionId: string) => void
  onSetup: (setup: AcpSessionSetup) => void
  onTitle: (title: string) => void
  onTurnEnd: (turnId: string, end: TurnEnd) => void
  displayScreenshot?: (callId: string) => { dataUrl: string } | null
  /** The registry call id behind the ClosedAI tool the agent just reported, when the bridge served one. */
  takeCallId?: (namespace: string, tool: string) => string | null
  /** When set, every JSON-RPC line in either direction is recorded in the turn trace. */
  traceScope?: () => TraceScope
  idleMs?: number
}

export class CursorSession {
  /** The ACP session this thread continues; set from the first `session/new` and used to reload. */
  sessionId: string | null = null
  activeTurnId: string | null = null
  private client: CursorAcpClient | null = null
  /** The session `this.client` currently holds, so one process never loads the same one twice. */
  private loadedSessionId: string | null = null
  private translator: CursorTurnTranslator | null = null
  private readonly idleGuard: IdleProcessGuard
  private opening: Promise<CursorAcpClient> | null = null
  /** The last setup the agent reported, reused while its session stays open on this process. */
  private setup: AcpSessionSetup | null = null
  /** Send closedai.instructions on the next turn; cleared after one delivery until the thread changes. */
  private instructionsPending = true
  /** Set only while `replay` is collecting another session's history off the same process. */
  private replaying: { sessionId: string; translator: CursorTurnTranslator; items: Map<string, ChatTranscriptItem> } | null = null
  private stopping = false

  constructor(private readonly deps: CursorSessionDeps) {
    this.idleGuard = new IdleProcessGuard(
      () => { if (!this.activeTurnId) void this.retire() },
      deps.idleMs
    )
  }

  get live(): boolean {
    return this.client?.connected === true
  }

  /** What the agent said it can do, or null before a handshake has completed. */
  get capabilities(): AcpCapabilities | null {
    return this.client?.capabilities ?? null
  }

  /**
   * Point the thread at the session the pane saved, without opening it. The first open loads that
   * session instead of creating one, so a relaunch continues the conversation rather than
   * abandoning it — and the agent's history is not filled with empty sessions no one can load.
   */
  adoptSaved(sessionId: string | null): void {
    if (!sessionId || this.sessionId || this.activeTurnId) return
    this.sessionId = sessionId
    this.instructionsPending = true
  }

  /** Prove the CLI answers and read the catalog, without committing the pane to a turn. */
  async warm(): Promise<AcpSessionSetup> {
    const client = await this.ensureClient()
    return this.ensureSession(client)
  }

  /** Start a turn: resolves when the message is accepted; the turn ends through `onTurnEnd`. */
  async send(blocks: readonly AcpPromptBlock[]): Promise<string> {
    if (this.activeTurnId) throw new Error('A Cursor turn is already running')
    const client = await this.ensureClient()
    const setup = await this.ensureSession(client)
    this.clearIdleTimer()
    const turnId = cursorTurnId()
    this.activeTurnId = turnId
    this.translator = new CursorTurnTranslator({
      turnId,
      seed: turnId,
      cwd: this.deps.cwd,
      ...(this.deps.displayScreenshot ? { displayScreenshot: this.deps.displayScreenshot } : {}),
      ...(this.deps.takeCallId ? { takeCallId: this.deps.takeCallId } : {})
    })
    this.deps.onTurn(turnId)
    client.prompt(setup.sessionId, blocks)
      .then((stopReason) => {
        if (this.activeTurnId !== turnId) return
        this.endTurn(cursorTurnEnd(stopReason))
        this.scheduleIdleClose()
      })
      .catch((error: unknown) => {
        if (this.activeTurnId !== turnId) return
        this.endTurn({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
      })
    return turnId
  }

  /** Pause the running turn in protocol, leaving the session open for the next one. */
  async interrupt(): Promise<void> {
    if (!this.activeTurnId || !this.client || !this.sessionId) return
    this.stopping = true
    this.client.cancel(this.sessionId)
  }

  /** Select a model on the live session; a session opened later picks it up at `session/new`. */
  async selectModel(acpModelId: string): Promise<void> {
    if (!this.client?.connected || !this.sessionId) return
    await this.client.setModel(this.sessionId, acpModelId)
  }

  /** Close the live process but keep the session id, so the next turn reloads it. */
  async retire(): Promise<void> {
    this.clearIdleTimer()
    const client = this.client
    this.client = null
    this.opening = null
    this.loadedSessionId = null
    this.setup = null
    if (this.activeTurnId) {
      this.endTurn(this.stopping
        ? { status: 'interrupted' }
        : { status: 'failed', error: 'Cursor was stopped before the turn completed' })
    }
    this.stopping = false
    client?.stop()
  }

  /** Forget the session entirely; the next turn starts a new one. */
  async reset(): Promise<void> {
    await this.retire()
    this.sessionId = null
    this.instructionsPending = true
  }

  /**
   * Continue a session this process has just loaded — a chat opened from history. Switching used
   * to retire the process first, throwing away the one that had just loaded the session and
   * making the next turn pay another start; the agent holds several sessions at once.
   */
  continueWith(sessionId: string): void {
    if (this.sessionId === sessionId) return
    this.sessionId = sessionId
    this.instructionsPending = true
    this.deps.onSessionId(sessionId)
  }

  /** Whether this thread still needs the one-time ClosedAI instruction block for its session. */
  consumeInstructionsPending(): boolean {
    if (!this.instructionsPending) return false
    this.instructionsPending = false
    return true
  }

  /** Sessions the agent holds for this workspace, newest first. */
  async list(): Promise<Array<{ sessionId: string; title: string; updatedAt: number }>> {
    const client = await this.ensureClient()
    if (!client.capabilities?.listSessions) return []
    const sessions = await client.listSessions(this.deps.cwd)
    return sessions
      .map((entry) => {
        let title = entry.title?.trim() || 'New chat'
        if (title.includes('<closedai_context') || title.includes('closedai.instructions')) {
          title = 'Cursor chat'
        }
        return {
          sessionId: entry.sessionId,
          title,
          updatedAt: entry.updatedAt ? Date.parse(entry.updatedAt) || 0 : 0
        }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * The stored transcript of a session, by loading it and collecting the history ACP replays as
   * `session/update` notifications. Verified live: a load emits `user_message_chunk` and
   * `agent_message_chunk` for the whole conversation, then resolves.
   */
  async replay(sessionId: string): Promise<ChatTranscriptItem[]> {
    const client = await this.ensureClient()
    if (!client.capabilities?.loadSession) return []
    const items = new Map<string, ChatTranscriptItem>()
    const translator = new CursorTurnTranslator({ turnId: null, seed: sessionId, cwd: this.deps.cwd })
    this.replaying = { sessionId, translator, items }
    try {
      await client.loadSession(sessionId, this.deps.cwd, this.deps.mcpServers())
      this.loadedSessionId = sessionId
      for (const op of translator.finish()) if (op.type === 'item') items.set(op.item.id, op.item)
    } finally {
      this.replaying = null
    }
    return [...items.values()]
  }

  private async ensureClient(): Promise<CursorAcpClient> {
    if (this.client?.connected) return this.client
    this.opening ??= this.openClient().finally(() => { this.opening = null })
    return this.opening
  }

  private async openClient(): Promise<CursorAcpClient> {
    const client = new CursorAcpClient(this.deps.cwd, this.deps.traceScope ?? null)
    client.on('notification', (event: { method: string; params?: unknown }) => {
      if (this.client === client && event.method === 'session/update') this.onUpdate(event.params)
    })
    client.on('exit', () => { if (this.client === client) this.onExit() })
    client.on('protocolError', (error: Error) => console.warn('[Cursor ACP]', error.message))
    await client.start()
    this.client = client
    return client
  }

  /**
   * Open the thread's session on this process. A session id the agent no longer holds — a stale
   * id from a previous run, or one `loadSession` cannot serve — falls back to a fresh session
   * rather than failing the turn.
   */
  private async ensureSession(client: CursorAcpClient): Promise<AcpSessionSetup> {
    const mcpServers = this.deps.mcpServers()
    // Already open on this process — a replay loaded it, or the last turn did. Loading again
    // costs a round trip and tells the agent nothing it does not know.
    if (this.sessionId && this.sessionId === this.loadedSessionId && this.setup) return this.setup
    if (this.sessionId && client.capabilities?.loadSession) {
      const loaded = await client.loadSession(this.sessionId, this.deps.cwd, mcpServers).catch(() => null)
      if (loaded) {
        this.loadedSessionId = loaded.sessionId
        return this.adoptSetup(loaded)
      }
    }
    const created = await client.newSession(this.deps.cwd, mcpServers)
    this.loadedSessionId = created.sessionId
    const model = this.deps.modelId()
    if (model && model !== created.currentModelId) {
      await client.setModel(created.sessionId, model).catch((error: unknown) => {
        console.warn('[Cursor ACP] could not select the model:', error instanceof Error ? error.message : error)
      })
    }
    return this.adoptSetup(created)
  }

  private adoptSetup(setup: AcpSessionSetup): AcpSessionSetup {
    this.setup = setup
    if (setup.sessionId && setup.sessionId !== this.sessionId) {
      this.sessionId = setup.sessionId
      this.deps.onSessionId(setup.sessionId)
    }
    this.deps.onSetup(setup)
    return setup
  }

  private onUpdate(params: unknown): void {
    const sessionId = typeof (params as { sessionId?: unknown } | null)?.sessionId === 'string'
      ? (params as { sessionId: string }).sessionId
      : null
    const replaying = this.replaying
    if (replaying && sessionId === replaying.sessionId) {
      for (const op of replaying.translator.handle(params).ops) {
        if (op.type === 'item') replaying.items.set(op.item.id, op.item)
      }
      return
    }
    const translator = this.translator
    // A load running for another session must not be mistaken for this thread's turn.
    if (!translator || (sessionId !== null && sessionId !== this.sessionId)) return
    const translation = translator.handle(params)
    for (const op of translation.ops) this.deps.apply(op)
    if (translation.title) this.deps.onTitle(translation.title)
  }

  private onExit(): void {
    this.client = null
    this.loadedSessionId = null
    this.setup = null
    this.clearIdleTimer()
    if (!this.activeTurnId) return
    this.endTurn(this.stopping
      ? { status: 'interrupted' }
      : { status: 'failed', error: 'Cursor stopped before the turn completed' })
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
    this.idleGuard.schedule(Boolean(this.client))
  }

  private clearIdleTimer(): void {
    this.idleGuard.clear()
  }
}
