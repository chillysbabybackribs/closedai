import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { AGENT_RUN_CONTINUE_DELAY_MS, AGENT_RUN_MAX_FAILURES, AGENT_RUN_RETRY_DELAYS_MS, AGENT_RUN_TURN_START_TIMEOUT_MS } from '../../shared/agent-runs.js'
import type { ChatEvent, ChatSnapshot } from '../../shared/chat.js'
import { ChatStore } from '../chat-store/chat-store.js'
import { AGENT_RUN_RELAUNCH_REASON, AgentRunService, type AgentRunChatHost } from './agent-run-service.js'

type Harness = {
  store: ChatStore
  service: AgentRunService
  sent: string[]
  interrupted: string[]
  panes: Map<string, { activeTurnId: string | null; threadId: string | null }>
  /** Emit a pane event and mirror the turn state the peer manager would report. */
  emit(chatId: string, event: ChatEvent): void
  /** A full turn: start, an assistant item (unless `empty`), and the end. */
  turn(chatId: string, options?: { empty?: boolean; thread?: string }): void
  flush(): Promise<void>
}

function harness(options: { sendError?: () => Error | null } = {}): Harness {
  const store = ChatStore.inMemory()
  const events = new EventEmitter()
  const sent: string[] = []
  const interrupted: string[] = []
  const panes = new Map<string, { activeTurnId: string | null; threadId: string | null }>()
  const host: AgentRunChatHost = {
    paneSnapshot: (paneId) => {
      const pane = panes.get(paneId)
      return pane ? ({ activeTurnId: pane.activeTurnId, threadId: pane.threadId } as ChatSnapshot) : null
    },
    send: async (paneId, text) => {
      const error = options.sendError?.() ?? null
      if (error) throw error
      sent.push(`${paneId}:${text}`)
    },
    interrupt: async (paneId) => { interrupted.push(paneId) },
    on: (event, listener) => events.on(event, listener),
    off: (event, listener) => events.off(event, listener)
  }
  const service = new AgentRunService(store, host)
  const emit = (chatId: string, event: ChatEvent): void => {
    const pane = panes.get(chatId)
    if (pane && event.type === 'turn') pane.activeTurnId = event.turnId
    events.emit('event', { type: 'pane', paneId: chatId, event })
  }
  let turns = 0
  return {
    store, service, sent, interrupted, panes, emit,
    turn: (chatId, turnOptions = {}) => {
      const pane = panes.get(chatId)
      if (pane && turnOptions.thread) pane.threadId = turnOptions.thread
      turns += 1
      emit(chatId, { type: 'turn', turnId: `t${turns}` })
      if (!turnOptions.empty) emit(chatId, { type: 'item', item: { type: 'assistant', id: `a${turns}`, turnId: `t${turns}`, text: 'done' } as never })
      emit(chatId, { type: 'turn', turnId: null })
    },
    flush: () => new Promise((resolve) => setImmediate(resolve))
  }
}

function openChat(h: Harness, id = 'chat-1'): string {
  h.store.create({ id, cwd: '/w', projectPath: null, provider: 'codex', modelId: 'gpt-5', reasoningEffort: null })
  h.panes.set(id, { activeTurnId: null, threadId: null })
  return id
}

test('starting a run sends the prompt as cycle 1 and each finished turn drives the next cycle', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  h.service.start()
  const id = openChat(h)
  const run = await h.service.startRun(id, { prompt: 'Keep the app healthy.' })
  assert.equal(run.cycle, 1)
  assert.deepEqual(h.sent, [`${id}:Keep the app healthy.`])
  h.turn(id, { thread: 'thread-a' })
  assert.equal(h.sent.length, 1, 'the next cycle waits for the settle delay')
  t.mock.timers.tick(AGENT_RUN_CONTINUE_DELAY_MS)
  await h.flush()
  assert.equal(h.sent.length, 2)
  assert.match(h.sent[1]!, /^chat-1:Cycle 2\. Start the next cycle/)
  assert.equal(h.service.get(id)?.cycle, 2)
  assert.equal(h.service.get(id)?.threadId, 'thread-a')
  assert.equal(h.store.require(id).agentRun?.status, 'running', 'the run is persisted on the chat record')
})

test('a provider thread change re-sends the standing instructions', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  h.service.start()
  const id = openChat(h)
  await h.service.startRun(id, { prompt: 'Standing orders.' })
  h.turn(id, { thread: 'thread-a' })
  t.mock.timers.tick(AGENT_RUN_CONTINUE_DELAY_MS)
  await h.flush()
  h.turn(id, { thread: 'thread-b' })
  t.mock.timers.tick(AGENT_RUN_CONTINUE_DELAY_MS)
  await h.flush()
  assert.equal(h.sent.length, 3)
  assert.match(h.sent[2]!, /context was rotated[\s\S]*Standing orders\.[\s\S]*Start cycle 3 now/)
})

test('turns without output back off and finally pause with the reason', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  h.service.start()
  const id = openChat(h)
  await h.service.startRun(id, { prompt: 'Go.' })
  for (let failure = 1; failure < AGENT_RUN_MAX_FAILURES; failure += 1) {
    h.turn(id, { empty: true })
    const run = h.service.get(id)!
    assert.equal(run.status, 'running')
    assert.equal(run.failures, failure)
    assert.match(run.reason ?? '', /^Retry/)
    t.mock.timers.tick(AGENT_RUN_RETRY_DELAYS_MS[failure - 1]!)
    await h.flush()
    assert.equal(h.sent.length, failure + 1)
  }
  h.turn(id, { empty: true })
  const paused = h.service.get(id)!
  assert.equal(paused.status, 'paused')
  assert.equal(paused.failures, AGENT_RUN_MAX_FAILURES)
  assert.match(paused.reason ?? '', /turns in a row failed/)
  t.mock.timers.tick(200_000)
  await h.flush()
  assert.equal(h.sent.length, AGENT_RUN_MAX_FAILURES, 'a paused run sends nothing')
})

test('a healthy turn resets the failure count', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  h.service.start()
  const id = openChat(h)
  await h.service.startRun(id, { prompt: 'Go.' })
  h.turn(id, { empty: true })
  t.mock.timers.tick(AGENT_RUN_RETRY_DELAYS_MS[0]!)
  await h.flush()
  h.turn(id)
  assert.equal(h.service.get(id)?.failures, 0)
  assert.equal(h.service.get(id)?.reason, null)
})

test('a send that starts no turn is a failure after the watchdog', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  h.service.start()
  const id = openChat(h)
  await h.service.startRun(id, { prompt: 'Go.' })
  t.mock.timers.tick(AGENT_RUN_TURN_START_TIMEOUT_MS)
  const run = h.service.get(id)!
  assert.equal(run.failures, 1)
  assert.match(run.reason ?? '', /No turn started/)
})

test('a first send that fails removes the run and reports the error', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness({ sendError: () => new Error('Codex is signed out') })
  h.service.start()
  const id = openChat(h)
  await assert.rejects(h.service.startRun(id, { prompt: 'Go.' }), /signed out/)
  assert.equal(h.service.get(id), null)
  assert.equal(h.store.require(id).agentRun, null)
})

test('the composer pause is the stop signal; resume drives again when the pane is idle', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  h.service.start()
  const id = openChat(h)
  await h.service.startRun(id, { prompt: 'Go.' })
  h.emit(id, { type: 'turn', turnId: 't1' })
  h.emit(id, { type: 'item', item: { type: 'assistant', id: 'a1', turnId: 't1', text: 'partial' } as never })
  h.emit(id, { type: 'turn', turnId: null })
  h.emit(id, { type: 'paused', turnId: 't1' })
  await h.flush()
  assert.equal(h.service.get(id)?.status, 'paused')
  assert.equal(h.service.get(id)?.reason, 'Paused from the composer')
  t.mock.timers.tick(AGENT_RUN_CONTINUE_DELAY_MS * 2)
  await h.flush()
  assert.equal(h.sent.length, 1, 'the scheduled cycle was cancelled by the pause')
  await h.service.resumeRun(id)
  t.mock.timers.tick(0)
  await h.flush()
  assert.equal(h.sent.length, 2)
  assert.equal(h.service.get(id)?.status, 'running')
})

test('pause from the strip interrupts the turn in flight; stop removes the run', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  h.service.start()
  const id = openChat(h)
  await h.service.startRun(id, { prompt: 'Go.' })
  h.emit(id, { type: 'turn', turnId: 't1' })
  await h.service.pauseRun(id, 'Paused by you', { interrupt: true })
  assert.deepEqual(h.interrupted, [id])
  assert.equal(h.service.get(id)?.status, 'paused')
  h.emit(id, { type: 'turn', turnId: 't2' })
  await h.service.stopRun(id)
  assert.deepEqual(h.interrupted, [id, id])
  assert.equal(h.service.get(id), null)
  assert.deepEqual(h.service.runs(), [])
})

test('maxCycles pauses the run once the last cycle finishes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  h.service.start()
  const id = openChat(h)
  await h.service.startRun(id, { prompt: 'Go.', maxCycles: 2 })
  h.turn(id)
  t.mock.timers.tick(AGENT_RUN_CONTINUE_DELAY_MS)
  await h.flush()
  assert.equal(h.service.get(id)?.cycle, 2)
  h.turn(id)
  assert.equal(h.service.get(id)?.status, 'paused')
  assert.equal(h.service.get(id)?.reason, 'Reached 2 cycles')
})

test('a user turn between cycles is folded into the loop, not raced', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  h.service.start()
  const id = openChat(h)
  await h.service.startRun(id, { prompt: 'Go.' })
  h.turn(id)
  // The user sends a steering message before the settle delay elapses.
  h.emit(id, { type: 'turn', turnId: 'user-turn' })
  t.mock.timers.tick(AGENT_RUN_CONTINUE_DELAY_MS)
  await h.flush()
  assert.equal(h.sent.length, 1, 'nothing is sent while the user turn runs')
  h.emit(id, { type: 'item', item: { type: 'assistant', id: 'a2', turnId: 'user-turn', text: 'ok' } as never })
  h.emit(id, { type: 'turn', turnId: null })
  t.mock.timers.tick(AGENT_RUN_CONTINUE_DELAY_MS)
  await h.flush()
  assert.equal(h.sent.length, 2)
})

test('runs that were running at quit come back paused; archiving pauses and hides a run', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  const id = openChat(h)
  const at = Date.now()
  h.store.update(id, { agentRun: { chatId: id, prompt: 'Go.', status: 'running', cycle: 4, maxCycles: null, startedAt: at, updatedAt: at,
    lastTurnEndedAt: at, reason: null, failures: 0, threadId: 'thread-a' } })
  const events: number[] = []
  h.service.on('change', (event: { runs: unknown[] }) => events.push(event.runs.length))
  h.service.start()
  assert.equal(h.service.get(id)?.status, 'paused')
  assert.equal(h.service.get(id)?.reason, AGENT_RUN_RELAUNCH_REASON)
  assert.equal(h.service.get(id)?.cycle, 4)
  assert.deepEqual(events, [1, 1])
  await h.service.resumeRun(id)
  h.store.archive(id)
  assert.equal(h.service.get(id), null)
  assert.equal(h.store.require(id).agentRun?.status, 'paused')
  t.mock.timers.tick(AGENT_RUN_CONTINUE_DELAY_MS)
  await h.flush()
  assert.equal(h.sent.length, 0)
})

test('a run cannot start in a chat that is not open or already has a running agent', async () => {
  const h = harness()
  h.service.start()
  const id = openChat(h)
  h.panes.delete(id)
  await assert.rejects(h.service.startRun(id, { prompt: 'Go.' }), /Open the chat/)
  h.panes.set(id, { activeTurnId: null, threadId: null })
  await h.service.startRun(id, { prompt: 'Go.' })
  await assert.rejects(h.service.startRun(id, { prompt: 'Again.' }), /already has a running agent/)
  await assert.rejects(h.service.startRun(id, { prompt: '   ' }), /standing instructions/)
  h.service.stop()
})
