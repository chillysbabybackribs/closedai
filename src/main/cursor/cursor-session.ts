import {
  CursorAcpClient, isAcpSessionNotFound,
  type AcpCapabilities, type AcpMcpServer, type AcpPromptBlock, type AcpSessionSetup
} from './cursor-acp.js'
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
// reopens the same session in a fresh one — and a model change is an in-session config update,
// not a respawn.

export type CursorSessionDeps = {
  cwd: string
  /**
   * The ClosedAI tool endpoints for this pane. Async because the agent only ever learns about
   * them at `session/new` / `session/load`: a session opened before the bridge was listening gets
   * an empty list and stays toolless for its whole life, so resolving them has to be able to
   * start the bridge rather than report whatever it happens to have.
   */
  mcpServers: () => Promise<readonly AcpMcpServer[]>
  /** The ACP model id to select on a fresh session, or null for the agent's own default. */
  modelId: () => string | null
  apply: (op: TranscriptOp) => void
  onTurn: (turnId: string | null) => void
  /** The thread's session changed — including to one the agent has only reserved so far. */
  onSessionId: (sessionId: string) => void
  /**
   * The session became one the agent can reopen: it was loaded, or it has taken a turn. A session
   * `session/new` just opened is gone from any later process until it has been prompted (see
   * `isAcpSessionNotFound`), so this — not `onSessionId` — is when the pane saves the id.
   */
  onSessionSaved: (sessionId: string) => void
  /**
   * The saved session could not be reopened and a new one replaced it, so the agent no longer
   * holds the conversation the pane shows. Awaited before the turn uses the new session.
   */
  onSessionLost?: (sessionId: string, reason: string) => Promise<void> | void
  onSetup: (setup: AcpSessionSetup) => void
  onTurnEnd: (turnId: string, end: TurnEnd) => void
  displayScreenshot?: (callId: string) => { dataUrl: string } | null
  /** The registry call id behind the ClosedAI tool the agent just reported, when the bridge served one. */
  takeCallId?: (namespace: string, tool: string) => string | null
  /** When set, every JSON-RPC line in either direction is recorded in the turn trace. */
  traceScope?: () => TraceScope
  idleMs?: number | (() => number)
  childEnv?: () => NodeJS.ProcessEnv
}

export class CursorSession {
  /** The ACP session this thread continues; set from the first `session/new` and used to reload. */
  sessionId: string | null = null
  activeTurnId: string | null = null
  private client: CursorAcpClient | null = null
  /** The session `this.client` currently holds, so one process never loads the same one twice. */
  private loadedSessionId: string | null = null
  /** The session last reported through `onSessionSaved` (or seeded from the pane's save). */
  private savedSessionId: string | null = null
  private translator: CursorTurnTranslator | null = null
  private readonly idleGuard: IdleProcessGuard
  private opening: Promise<CursorAcpClient> | null = null
  private sessionOpening: Promise<AcpSessionSetup> | null = null
  /** The last setup the agent reported, reused while its session stays open on this process. */
  private setup: AcpSessionSetup | null = null
  /**
   * The tool endpoints the live session was opened with. Verified live against cursor-agent on
   * 2026-09-21: the agent connects the servers it is given at `session/new` and at `session/load`
   * (both produce an MCP `initialize` against the endpoint), and never asks again. So a session
   * opened with a different list — an empty one, or one from a bridge that has since restarted on
   * another port — has to be reopened, not reused.
   */
  private attachedServers: string | null = null
  /** Set only while `replay` is collecting another session's history off the same process. */
  private replaying: { sessionId: string; translator: CursorTurnTranslator; items: Map<string, ChatTranscriptItem> } | null = null
  private replayTail: Promise<void> = Promise.resolve()
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
    this.savedSessionId = sessionId
  }

  /** Prove the CLI answers and read the catalog, without committing the pane to a turn. */
  async warm(): Promise<AcpSessionSetup> {
    const client = await this.ensureClient()
    return this.ensureSession(client)
  }

  /** Reserve a turn id before prompt assembly so the pane can show work in flight. */
  beginTurn(turnId: string): void {
    if (this.activeTurnId) throw new Error('A Cursor turn is already running')
    this.activeTurnId = turnId
  }

  /** Drop a turn that never reached the agent, after prompt assembly fails. */
  abortTurn(turnId: string): void {
    if (this.activeTurnId !== turnId) return
    this.endTurn({ status: 'failed', error: 'Turn did not start' })
  }

  /** Start a turn: resolves when the message is accepted; the turn ends through `onTurnEnd`. */
  async send(blocks: readonly AcpPromptBlock[], turnId: string): Promise<string> {
    if (this.activeTurnId !== turnId) throw new Error('A Cursor turn is already running')
    this.clearIdleTimer()
    try {
      const client = await this.ensureClient()
      const setup = await this.ensureSession(client)
      this.translator = new CursorTurnTranslator({
        turnId,
        seed: turnId,
        cwd: this.deps.cwd,
        ...(this.deps.displayScreenshot ? { displayScreenshot: this.deps.displayScreenshot } : {}),
        ...(this.deps.takeCallId ? { takeCallId: this.deps.takeCallId } : {})
      })
      client.prompt(setup.sessionId, blocks)
        .then((stopReason) => {
          this.markSaved(setup.sessionId)
          if (this.activeTurnId !== turnId) return
          this.endTurn(cursorTurnEnd(stopReason))
          this.scheduleIdleClose()
        })
        .catch((error: unknown) => {
          if (this.activeTurnId !== turnId) return
          this.endTurn({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
        })
      return turnId
    } catch (error: unknown) {
      this.endTurn({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
      throw error
    }
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
    const modelConfigId = this.setup?.modelConfigId
    if (modelConfigId) await this.client.setConfigOption(this.sessionId, modelConfigId, acpModelId)
    else await this.client.setModel(this.sessionId, acpModelId)
    if (this.setup) this.setup = { ...this.setup, currentModelId: acpModelId }
  }

  /** Close the live process but keep the session id, so the next turn reloads it. */
  async retire(): Promise<void> {
    this.clearIdleTimer()
    const client = this.client
    this.client = null
    this.opening = null
    this.loadedSessionId = null
    this.setup = null
    this.attachedServers = null
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
    this.savedSessionId = null
  }

  /**
   * Continue a session this process has just loaded — a chat opened from history. Switching used
   * to retire the process first, throwing away the one that had just loaded the session and
   * making the next turn pay another start; the agent holds several sessions at once.
   */
  continueWith(sessionId: string): void {
    if (this.loadedSessionId === sessionId && this.setup) this.deps.onSetup(this.setup)
    // Only a replayed session gets here, and the caller saves it with the history it restored.
    this.savedSessionId = sessionId
    if (this.sessionId === sessionId) return
    this.sessionId = sessionId
    this.deps.onSessionId(sessionId)
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
  replay(sessionId: string, cwd = this.deps.cwd): Promise<ChatTranscriptItem[]> {
    // ACP history shares one notification collector; concurrent recalls must not overwrite it.
    const result = this.replayTail.then(() => this.replayHistory(sessionId, cwd))
    this.replayTail = result.then(() => undefined, () => undefined)
    return result
  }

  private async replayHistory(sessionId: string, cwd: string): Promise<ChatTranscriptItem[]> {
    const client = await this.ensureClient()
    if (!client.capabilities?.loadSession) return []
    const items = new Map<string, ChatTranscriptItem>()
    const translator = new CursorTurnTranslator({ turnId: null, seed: sessionId, cwd })
    this.replaying = { sessionId, translator, items }
    const mcpServers = await this.deps.mcpServers()
    try {
      const setup = await client.loadSession(sessionId, cwd, mcpServers)
      this.loadedSessionId = sessionId
      this.attachedServers = serverSignature(mcpServers)
      this.setup = setup
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
    const client = new CursorAcpClient(this.deps.cwd, this.deps.traceScope ?? null, this.deps.childEnv)
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
   * rather than failing the turn, and the pane is told so it can carry its conversation over. One open at a time: a new chat's warm-up and its first send
   * would otherwise each create a session, and the turn would stream into the one the thread is
   * not listening to. A caller that waited reuses the session the open before it settled.
   */
  private async ensureSession(client: CursorAcpClient): Promise<AcpSessionSetup> {
    while (this.sessionOpening) await this.sessionOpening.catch(() => undefined)
    const opening = this.openSession(client)
    this.sessionOpening = opening
    try {
      return await opening
    } finally {
      if (this.sessionOpening === opening) this.sessionOpening = null
    }
  }

  private async openSession(client: CursorAcpClient): Promise<AcpSessionSetup> {
    const mcpServers = await this.deps.mcpServers()
    const attaching = serverSignature(mcpServers)
    // Already open on this process with the tools it would be given now — a replay loaded it, or
    // the last turn did. Loading again costs a round trip and tells the agent nothing it does not
    // know. A session holding a different list is reopened instead: that is the only way it can
    // learn about endpoints it was not given when it opened.
    if (this.sessionId && this.sessionId === this.loadedSessionId && this.setup && this.attachedServers === attaching) {
      return this.setup
    }
    let lost: { sessionId: string; reason: string } | null = null
    if (this.sessionId && client.capabilities?.loadSession) {
      const sessionId = this.sessionId
      try {
        const loaded = await client.loadSession(sessionId, this.deps.cwd, mcpServers)
        this.loadedSessionId = loaded.sessionId
        this.attachedServers = attaching
        const setup = this.adoptSetup(loaded)
        this.markSaved(setup.sessionId)
        return setup
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        // An id that was reserved but never prompted is expected to be gone; anything else is not.
        if (!isAcpSessionNotFound(error) || this.savedSessionId === sessionId) {
          console.warn(`[Cursor ACP] could not reopen session ${sessionId}; starting a new one:`, reason)
        }
        if (this.savedSessionId === sessionId) lost = { sessionId, reason }
      }
    }
    const created = await client.newSession(this.deps.cwd, mcpServers)
    this.loadedSessionId = created.sessionId
    this.attachedServers = attaching
    const model = this.deps.modelId()
    if (model && model !== created.currentModelId) {
      const selecting = created.modelConfigId
        ? client.setConfigOption(created.sessionId, created.modelConfigId, model)
        : client.setModel(created.sessionId, model)
      await selecting.then(() => {
        created.currentModelId = model
      }).catch((error: unknown) => {
        console.warn('[Cursor ACP] could not select the model:', error instanceof Error ? error.message : error)
      })
    }
    const setup = this.adoptSetup(created)
    if (lost) await this.deps.onSessionLost?.(lost.sessionId, lost.reason)
    return setup
  }

  private markSaved(sessionId: string): void {
    if (!sessionId || this.savedSessionId === sessionId) return
    this.savedSessionId = sessionId
    this.deps.onSessionSaved(sessionId)
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
    // Measured at ~0.7s into a first turn; the agent announces its commands before it has stored anything.
    if (this.sessionId && updateKind(params) !== 'available_commands_update') this.markSaved(this.sessionId)
    const translation = translator.handle(params)
    for (const op of translation.ops) this.deps.apply(op)
  }

  private onExit(): void {
    this.client = null
    this.loadedSessionId = null
    this.setup = null
    this.attachedServers = null
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

function updateKind(params: unknown): unknown {
  return (params as { update?: { sessionUpdate?: unknown } } | null)?.update?.sessionUpdate
}

/** Identity of a tool endpoint set: same names on same URLs means the agent needs no new attach. */
function serverSignature(servers: readonly AcpMcpServer[]): string {
  return servers.map((server) => `${server.name}@${server.url}`).sort().join('|')
}
