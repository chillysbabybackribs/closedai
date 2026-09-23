import { EventEmitter } from 'node:events'
import {
  AGENT_RUN_CONTINUE_DELAY_MS, AGENT_RUN_MAX_FAILURES, AGENT_RUN_MAX_PROMPT_CHARS, AGENT_RUN_TURN_START_TIMEOUT_MS,
  agentCycleMessage, agentRunRetryDelay, type AgentRun, type AgentRunStartOptions, type AgentRunsEvent
} from '../../shared/agent-runs.js'
import type { ChatEvent, ChatSnapshot } from '../../shared/chat.js'
import type { ChatWorkspaceEvent } from '../../shared/chat-peers.js'
import type { ChatStore, ChatStoreChange } from '../chat-store/chat-store.js'

// The loop that makes an agent chat an agent: a provider ends a turn, this service sends the
// next cycle. The chat itself is ordinary — same pane, same composer, same provider session —
// so the user can watch, steer with a message of their own, or pause it. State lives on the
// chat record (`agentRun`), so a relaunch finds every run and brings it back paused.
//
// A turn that produced no assistant or tool output counts as a failure: a provider that is
// signed out, disconnected, or rejecting the send ends turns immediately, and re-sending on
// every one of those would loop as fast as the provider fails. Failures back off and finally
// pause the run with the reason on the strip.

/** What the runtime needs from the chat workspace; `ChatPeerManager` satisfies it. */
export type AgentRunChatHost = {
  paneSnapshot(paneId: string): ChatSnapshot | null
  send(paneId: string, text: string, attachments: []): Promise<void>
  interrupt(paneId: string): Promise<void>
  on(event: 'event', listener: (event: ChatWorkspaceEvent) => void): unknown
  off(event: 'event', listener: (event: ChatWorkspaceEvent) => void): unknown
}

type LiveState = {
  /** The pending next-cycle send or the turn-start watchdog; only one is ever armed. */
  timer: NodeJS.Timeout | null
  turnActive: boolean
  /** Whether the current turn has produced anything besides the user message and notices. */
  sawOutput: boolean
  /** A driven send is out and no turn has started for it yet. */
  awaitingStart: boolean
}

export const AGENT_RUN_RELAUNCH_REASON = 'App relaunched'

export class AgentRunService extends EventEmitter {
  private readonly live = new Map<string, LiveState>()
  private readonly onChatEvent = (event: ChatWorkspaceEvent): void => this.handleChatEvent(event)
  private readonly onStoreChange = (change: ChatStoreChange): void => this.handleStoreChange(change)
  private started = false

  constructor(
    private readonly store: ChatStore,
    private readonly chat: AgentRunChatHost,
    private readonly now: () => number = () => Date.now()
  ) {
    super()
  }

  /** Attach to the chat workspace; runs that were running when the app last quit come back paused. */
  start(): void {
    if (this.started) return
    this.started = true
    for (const id of this.store.ids()) {
      const run = this.store.get(id)?.agentRun
      if (run?.status === 'running') this.patch(id, { status: 'paused', reason: AGENT_RUN_RELAUNCH_REASON })
    }
    this.chat.on('event', this.onChatEvent)
    this.store.on('change', this.onStoreChange)
    this.emitChange()
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.chat.off('event', this.onChatEvent)
    this.store.off('change', this.onStoreChange)
    for (const live of this.live.values()) this.clearTimer(live)
    this.live.clear()
  }

  runs(): AgentRun[] {
    return this.store.ids().flatMap((id) => {
      const record = this.store.get(id)
      return record && !record.archived && record.agentRun ? [record.agentRun] : []
    })
  }

  get(chatId: string): AgentRun | null {
    const record = this.store.get(chatId)
    return record && !record.archived ? record.agentRun : null
  }

  /** Create the run and send its first cycle; a first send that fails removes the run and throws. */
  async startRun(chatId: string, options: AgentRunStartOptions): Promise<AgentRun> {
    const prompt = options.prompt.trim()
    if (!prompt) throw new Error('Give the agent standing instructions before starting it')
    if (prompt.length > AGENT_RUN_MAX_PROMPT_CHARS) throw new Error(`Agent instructions are limited to ${AGENT_RUN_MAX_PROMPT_CHARS} characters`)
    const maxCycles = options.maxCycles ?? null
    if (maxCycles !== null && (!Number.isInteger(maxCycles) || maxCycles < 1)) throw new Error('maxCycles must be a whole number of at least 1')
    this.store.require(chatId)
    if (!this.chat.paneSnapshot(chatId)) throw new Error('Open the chat before starting an agent in it')
    if (this.get(chatId)?.status === 'running') throw new Error('This chat already has a running agent; pause or stop it first')
    const at = this.now()
    const run: AgentRun = {
      chatId, prompt, status: 'running', cycle: 0, maxCycles, startedAt: at, updatedAt: at,
      lastTurnEndedAt: null, reason: null, failures: 0, threadId: null
    }
    this.store.update(chatId, { agentRun: run })
    this.emitChange()
    try {
      await this.sendCycle(chatId)
    } catch (error) {
      this.forget(chatId)
      throw error
    }
    return this.get(chatId) ?? run
  }

  /** Stop driving the chat. From the strip this also ends the turn in flight; runtime pauses do not. */
  async pauseRun(chatId: string, reason: string, options: { interrupt?: boolean } = {}): Promise<AgentRun | null> {
    const run = this.get(chatId)
    if (!run) return null
    const live = this.liveFor(chatId)
    this.clearTimer(live)
    live.awaitingStart = false
    const paused = run.status === 'running' ? this.patch(chatId, { status: 'paused', reason }) : run
    if (options.interrupt && this.chat.paneSnapshot(chatId)?.activeTurnId) await this.chat.interrupt(chatId)
    return paused
  }

  /** Drive again: at once when the pane is idle, or after the turn in flight ends. */
  async resumeRun(chatId: string): Promise<AgentRun | null> {
    const run = this.get(chatId)
    if (!run) return null
    if (!this.chat.paneSnapshot(chatId)) throw new Error('Open the chat before resuming its agent')
    if (run.status === 'running') return run
    const resumed = this.patch(chatId, { status: 'running', reason: null, failures: 0 })
    this.schedule(chatId, 0)
    return resumed
  }

  /** End the run entirely, interrupting any turn in flight; the chat stays as an ordinary chat. */
  async stopRun(chatId: string): Promise<void> {
    if (!this.get(chatId)) return
    if (this.chat.paneSnapshot(chatId)?.activeTurnId) await this.chat.interrupt(chatId)
    this.forget(chatId)
  }

  private handleChatEvent(event: ChatWorkspaceEvent): void {
    if (event.type !== 'pane' || !this.get(event.paneId)) return
    this.noteChatEvent(event.paneId, event.event)
  }

  private noteChatEvent(chatId: string, event: ChatEvent): void {
    const live = this.liveFor(chatId)
    if (event.type === 'turn') {
      if (event.turnId) this.noteTurnStarted(chatId, live)
      else if (live.turnActive) this.noteTurnEnded(chatId, live)
    } else if (event.type === 'replace') {
      if (event.snapshot.activeTurnId && !live.turnActive) this.noteTurnStarted(chatId, live)
      else if (!event.snapshot.activeTurnId && live.turnActive) this.noteTurnEnded(chatId, live)
    } else if (event.type === 'item') {
      if (live.turnActive && event.item.type !== 'user' && event.item.type !== 'notice') live.sawOutput = true
    } else if (event.type === 'paused') {
      // The composer's pause button or a tool's stop_agent ended the turn: that is the user's stop signal.
      if (event.turnId && this.get(chatId)?.status === 'running') void this.pauseRun(chatId, 'Paused from the composer')
    }
  }

  private noteTurnStarted(chatId: string, live: LiveState): void {
    this.clearTimer(live)
    live.turnActive = true
    live.sawOutput = false
    live.awaitingStart = false
    // The thread the turn runs in; the first turn creates it, so the send-time id may be null.
    const threadId = this.chat.paneSnapshot(chatId)?.threadId ?? null
    const run = this.get(chatId)
    if (run && threadId && run.threadId !== threadId) this.patch(chatId, { threadId })
  }

  private noteTurnEnded(chatId: string, live: LiveState): void {
    live.turnActive = false
    const run = this.get(chatId)
    if (!run) return
    const at = this.now()
    if (run.status !== 'running') {
      this.patch(chatId, { lastTurnEndedAt: at })
      return
    }
    if (live.sawOutput) {
      const done = run.maxCycles !== null && run.cycle >= run.maxCycles
      this.patch(chatId, { lastTurnEndedAt: at, failures: 0, reason: done ? `Reached ${run.maxCycles} cycles` : null,
        ...(done ? { status: 'paused' as const } : {}) })
      if (!done) this.schedule(chatId, AGENT_RUN_CONTINUE_DELAY_MS)
      return
    }
    this.noteFailure(chatId, 'The turn ended without a response', { lastTurnEndedAt: at })
  }

  private noteFailure(chatId: string, detail: string, extra: Partial<AgentRun> = {}): void {
    const run = this.get(chatId)
    if (!run || run.status !== 'running') return
    const failures = run.failures + 1
    if (failures >= AGENT_RUN_MAX_FAILURES) {
      this.patch(chatId, { ...extra, failures, status: 'paused', reason: `${failures} turns in a row failed. Last: ${detail}` })
      return
    }
    const delay = agentRunRetryDelay(failures)
    this.patch(chatId, { ...extra, failures, reason: `Retry ${failures} of ${AGENT_RUN_MAX_FAILURES - 1} in ${Math.round(delay / 1000)}s: ${detail}` })
    this.schedule(chatId, delay)
  }

  private schedule(chatId: string, delayMs: number): void {
    const live = this.liveFor(chatId)
    this.clearTimer(live)
    live.timer = setTimeout(() => {
      live.timer = null
      void this.sendCycle(chatId).catch((error: unknown) => this.noteFailure(chatId, messageOf(error)))
    }, delayMs)
    live.timer.unref?.()
  }

  /** Send the next cycle if the run is still running and the pane is idle; rejects when the send does. */
  private async sendCycle(chatId: string): Promise<void> {
    const run = this.get(chatId)
    if (!run || run.status !== 'running') return
    const live = this.liveFor(chatId)
    const snapshot = this.chat.paneSnapshot(chatId)
    if (!snapshot) {
      this.patch(chatId, { status: 'paused', reason: 'Chat closed' })
      return
    }
    if (snapshot.activeTurnId) {
      // Someone else's turn (a user message, a Resume) is underway; its end schedules the next cycle.
      live.turnActive = true
      return
    }
    const threadChanged = run.threadId !== null && snapshot.threadId !== null && snapshot.threadId !== run.threadId
    const text = agentCycleMessage(run, threadChanged)
    this.patch(chatId, { cycle: run.cycle + 1, threadId: snapshot.threadId ?? run.threadId, reason: null })
    live.awaitingStart = true
    live.sawOutput = false
    this.clearTimer(live)
    live.timer = setTimeout(() => {
      live.timer = null
      if (live.awaitingStart && !live.turnActive) {
        live.awaitingStart = false
        this.noteFailure(chatId, 'No turn started after the message was sent')
      }
    }, AGENT_RUN_TURN_START_TIMEOUT_MS)
    live.timer.unref?.()
    try {
      await this.chat.send(chatId, text, [])
    } catch (error) {
      live.awaitingStart = false
      this.clearTimer(live)
      throw error
    }
  }

  private handleStoreChange(change: ChatStoreChange): void {
    for (const id of change.ids) {
      const record = this.store.get(id)
      if (record && !record.archived) continue
      const live = this.live.get(id)
      if (!live) continue
      this.clearTimer(live)
      this.live.delete(id)
      if (record?.agentRun?.status === 'running') this.patch(id, { status: 'paused', reason: 'Chat archived' })
      else this.emitChange()
    }
  }

  private patch(chatId: string, patch: Partial<Omit<AgentRun, 'chatId'>>): AgentRun {
    const current = this.store.require(chatId).agentRun
    if (!current) throw new Error(`Chat ${chatId} has no agent run`)
    const next: AgentRun = { ...current, ...patch, chatId, updatedAt: this.now() }
    this.store.update(chatId, { agentRun: next })
    this.emitChange()
    return next
  }

  private forget(chatId: string): void {
    const live = this.live.get(chatId)
    if (live) this.clearTimer(live)
    this.live.delete(chatId)
    if (this.store.has(chatId)) this.store.update(chatId, { agentRun: null })
    this.emitChange()
  }

  private liveFor(chatId: string): LiveState {
    let live = this.live.get(chatId)
    if (!live) {
      live = { timer: null, turnActive: Boolean(this.chat.paneSnapshot(chatId)?.activeTurnId), sawOutput: false, awaitingStart: false }
      this.live.set(chatId, live)
    }
    return live
  }

  private clearTimer(live: LiveState): void {
    if (live.timer) clearTimeout(live.timer)
    live.timer = null
  }

  private emitChange(): void {
    this.emit('change', { runs: this.runs() } satisfies AgentRunsEvent)
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
