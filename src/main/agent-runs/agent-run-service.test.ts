import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  AGENT_RUN_CONTINUE_DELAY_MS, AGENT_RUN_MAX_FAILURES, AGENT_RUN_RETRY_DELAYS_MS, AGENT_RUN_REVIEW_REASON, AGENT_RUN_TURN_START_TIMEOUT_MS,
  agentRunRemainingMs, emptyAgentRunStats
} from '../../shared/agent-runs.js'
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
  h.store.update(id, { agentRun: { chatId: id, prompt: 'Go.', status: 'running', cycle: 4, maxCycles: null, maxMinutes: null, activeMs: 0,
    activeSince: at, autonomous: true, startedAt: at, updatedAt: at,
    lastTurnEndedAt: at, reason: null, failures: 0, threadId: 'thread-a', agentId: null, name: null, stats: emptyAgentRunStats() } })
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

test('a start from the library keeps the agent id and name and announces the start once the first cycle is out', async () => {
  const h = harness()
  h.service.start()
  const id = openChat(h)
  const started: string[] = []
  h.service.on('started', (run: { agentId: string | null }) => started.push(run.agentId ?? 'one-off'))
  const run = await h.service.startRun(id, { prompt: 'Sort issues.', agentId: 'saved-1', name: ' Triage bot ' })
  assert.equal(run.agentId, 'saved-1')
  assert.equal(run.name, 'Triage bot')
  assert.deepEqual(started, ['saved-1'])
  await h.service.stopRun(id)
  const failing = harness({ sendError: () => new Error('offline') })
  failing.service.start()
  const other = openChat(failing, 'chat-2')
  let announced = 0
  failing.service.on('started', () => { announced += 1 })
  await assert.rejects(failing.service.startRun(other, { prompt: 'Go.', agentId: 'saved-1' }), /offline/)
  assert.equal(announced, 0, 'a failed first send is not a run')
})


test('the run tallies steps, edits, failures, replies, rotations, turn time and usage readings as the chat reports them', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  const h = harness()
  h.service.start()
  const id = openChat(h)
  await h.service.startRun(id, { prompt: 'Go.' })
  assert.deepEqual(h.service.get(id)?.stats, emptyAgentRunStats())
  h.panes.get(id)!.threadId = 'thread-a'
  h.emit(id, { type: 'turn', turnId: 't1' })
  assert.equal(h.service.get(id)?.stats.turnStartedAt, 1_000)
  const item = (item: unknown): void => h.emit(id, { type: 'item', item: item as never })
  item({ type: 'tool', id: 'k1', turnId: 't1', label: 'search.query', detail: '{}', status: 'in_progress' })
  item({ type: 'tool', id: 'k1', turnId: 't1', label: 'search.query', detail: '{}', status: 'in_progress' })
  item({ type: 'tool', id: 'k1', turnId: 't1', label: 'search.query', detail: '{}', status: 'completed' })
  item({ type: 'command', id: 'k2', turnId: 't1', command: 'npm test', cwd: '/w', status: 'completed', output: '', exitCode: 1 })
  item({ type: 'fileChange', id: 'k3', turnId: 't1', status: 'completed', changes: [{ path: 'a.ts', kind: 'update', diff: '' }] })
  item({ type: 'notice', id: 'n1', turnId: 't1', text: 'Provider **rejected** the request', tone: 'error' })
  item({ type: 'notice', id: 'n1', turnId: 't1', text: 'Provider **rejected** the request', tone: 'error' })
  item({ type: 'assistant', id: 'a1', turnId: 't1', text: '## Done\n\nFixed the *flaky* test.', phase: 'final_answer', streaming: true })
  assert.equal(h.service.get(id)?.stats.lastMessage, null, 'a streaming reply is not an excerpt yet')
  item({ type: 'assistant', id: 'a1', turnId: 't1', text: '## Done\n\nFixed the *flaky* test.', phase: 'final_answer', streaming: false })
  h.emit(id, { type: 'context', usage: { usedTokens: 61_000, contextWindow: 200_000, percent: 31 } })
  h.emit(id, { type: 'planUsage', usage: { plan: 'Pro', windows: [{ label: '5-hour', percent: 42, resetsAt: null }], note: null, unavailable: null, updatedAt: 1_000 } })
  t.mock.timers.tick(4_000)
  h.emit(id, { type: 'turn', turnId: null })
  const stats = h.service.get(id)!.stats
  assert.equal(stats.steps, 3, 'each item counts once however often it streams')
  assert.equal(stats.edits, 1)
  assert.equal(stats.errors, 2, 'one failed command and one error notice')
  assert.equal(stats.lastError, 'Provider rejected the request')
  assert.equal(stats.lastMessage, 'Done Fixed the flaky test.')
  assert.equal(stats.turnMs, 4_000)
  assert.equal(stats.turnStartedAt, null)
  assert.equal(stats.rotations, 0, 'the first thread is not a rotation')
  assert.deepEqual(stats.context, { usedTokens: 61_000, contextWindow: 200_000, percent: 31 })
  assert.equal(stats.plan?.windows[0]?.label, '5-hour')
  t.mock.timers.tick(AGENT_RUN_CONTINUE_DELAY_MS)
  await h.flush()
  h.turn(id, { thread: 'thread-b' })
  assert.equal(h.service.get(id)?.stats.rotations, 1, 'a thread change at turn start is a rotation')
  assert.equal(h.service.get(id)?.stats.steps, 3, 'the tallies survive across cycles')
  h.service.stop()
})

const MINUTE = 60_000

test('a time limit lets the turn in flight finish, then pauses with the reason; only running time counts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  const h = harness()
  h.service.start()
  const id = openChat(h)
  await h.service.startRun(id, { prompt: 'Go.', maxMinutes: 30 })
  h.emit(id, { type: 'turn', turnId: 't1' })
  t.mock.timers.tick(10 * MINUTE)
  await h.service.pauseRun(id, 'Paused by you', { interrupt: true })
  h.emit(id, { type: 'turn', turnId: null })
  assert.equal(h.service.get(id)?.activeMs, 10 * MINUTE)
  t.mock.timers.tick(90 * MINUTE)
  assert.equal(h.service.get(id)?.reason, 'Paused by you', 'a paused run is not timed out')
  assert.equal(agentRunRemainingMs(h.service.get(id)!, Date.now()), 20 * MINUTE, 'the pause cost nothing')
  await h.service.resumeRun(id)
  t.mock.timers.tick(0)
  await h.flush()
  // One long turn outlasts the limit: it is not interrupted, and its end pauses the run.
  h.emit(id, { type: 'turn', turnId: 't2' })
  h.emit(id, { type: 'item', item: { type: 'assistant', id: 'a2', turnId: 't2', text: 'working' } as never })
  t.mock.timers.tick(45 * MINUTE)
  await h.flush()
  assert.equal(h.service.get(id)?.status, 'running', 'the turn in flight is left to finish')
  assert.deepEqual(h.interrupted, [id], 'only the user\'s own pause interrupted anything')
  h.emit(id, { type: 'turn', turnId: null })
  const paused = h.service.get(id)!
  assert.equal(paused.status, 'paused')
  assert.equal(paused.reason, 'Reached 30 min')
  t.mock.timers.tick(AGENT_RUN_CONTINUE_DELAY_MS)
  await h.flush()
  assert.equal(h.sent.length, 2, 'no cycle follows the limit')
  // Resume after the limit is a fresh allowance, not an instant re-pause.
  await h.service.resumeRun(id)
  assert.equal(agentRunRemainingMs(h.service.get(id)!, Date.now()), 30 * MINUTE)
  h.service.stop()
})

test('a time limit that runs out between turns pauses at once, and a failed turn out of time is not retried', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  const h = harness()
  h.service.start()
  const id = openChat(h)
  await h.service.startRun(id, { prompt: 'Go.', maxMinutes: 1 })
  h.turn(id, { empty: true })
  assert.match(h.service.get(id)?.reason ?? '', /^Retry 1/)
  // The limit runs out inside the retry backoff: the deadline pauses the run, so the retry is never sent.
  t.mock.timers.tick(MINUTE)
  await h.flush()
  assert.equal(h.service.get(id)?.status, 'paused')
  assert.equal(h.service.get(id)?.reason, 'Reached 1 min')
  assert.deepEqual(h.interrupted, [])
  t.mock.timers.tick(AGENT_RUN_RETRY_DELAYS_MS[0]! * 4)
  await h.flush()
  assert.equal(h.sent.length, 1)
  const other = openChat(h, 'chat-2')
  await h.service.startRun(other, { prompt: 'Go.', maxMinutes: 1 })
  h.emit(other, { type: 'turn', turnId: 'long' })
  t.mock.timers.tick(5 * MINUTE)
  h.emit(other, { type: 'turn', turnId: null })
  assert.equal(h.service.get(other)?.reason, 'Reached 1 min', 'an empty turn that ran out the clock stops the run instead of retrying')
  assert.equal(h.service.get(other)?.failures, 0)
  h.service.stop()
})

test('a relaunch banks the running time up to the last write and keeps the limit', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 50 * MINUTE })
  const h = harness()
  const id = openChat(h)
  h.store.update(id, { agentRun: { chatId: id, prompt: 'Go.', status: 'running', cycle: 2, maxCycles: null, maxMinutes: 60, activeMs: 5 * MINUTE,
    activeSince: 10 * MINUTE, autonomous: true, startedAt: 1, updatedAt: 25 * MINUTE,
    lastTurnEndedAt: null, reason: null, failures: 0, threadId: null, agentId: null, name: null, stats: emptyAgentRunStats() } })
  h.service.start()
  const run = h.service.get(id)!
  assert.equal(run.status, 'paused')
  assert.equal(run.activeMs, 20 * MINUTE, 'five banked plus the fifteen on record; the time the app was closed is not counted')
  assert.equal(run.activeSince, null)
  assert.equal(agentRunRemainingMs(run, Date.now()), 40 * MINUTE)
  h.service.stop()
})

test('a supervised run pauses after every cycle and waits for Resume; a turn the user types is not a cycle', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  h.service.start()
  const id = openChat(h)
  await h.service.startRun(id, { prompt: 'Go.', autonomous: false })
  assert.match(h.sent[0]!, /^chat-1:Go\.\n\nRun settings[\s\S]*supervised/, 'the agent is told its own settings')
  h.turn(id)
  assert.equal(h.service.get(id)?.status, 'paused')
  assert.equal(h.service.get(id)?.reason, AGENT_RUN_REVIEW_REASON)
  t.mock.timers.tick(AGENT_RUN_CONTINUE_DELAY_MS * 4)
  await h.flush()
  assert.equal(h.sent.length, 1, 'nothing is sent until the user resumes')
  // The user asks a question while it waits, then resumes before the answer ends.
  h.emit(id, { type: 'turn', turnId: 'user-turn' })
  await h.service.resumeRun(id)
  t.mock.timers.tick(0)
  await h.flush()
  h.emit(id, { type: 'item', item: { type: 'assistant', id: 'u1', turnId: 'user-turn', text: 'answer' } as never })
  h.emit(id, { type: 'turn', turnId: null })
  assert.equal(h.service.get(id)?.status, 'running', 'the user turn did not use up the resume')
  t.mock.timers.tick(AGENT_RUN_CONTINUE_DELAY_MS)
  await h.flush()
  assert.equal(h.sent.length, 2)
  assert.match(h.sent[1]!, /^chat-1:Cycle 2\./)
  h.turn(id)
  assert.equal(h.service.get(id)?.reason, AGENT_RUN_REVIEW_REASON)
  assert.equal(h.service.get(id)?.cycle, 2)
  h.service.stop()
})

test('limits are validated at start, and a rotation re-sends the settings with the instructions', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 })
  const h = harness()
  h.service.start()
  const id = openChat(h)
  await assert.rejects(h.service.startRun(id, { prompt: 'Go.', maxMinutes: 0 }), /maxMinutes/)
  await assert.rejects(h.service.startRun(id, { prompt: 'Go.', maxMinutes: 1.5 }), /maxMinutes/)
  await h.service.startRun(id, { prompt: 'Go.', maxCycles: 9, maxMinutes: 120 })
  assert.match(h.sent[0]!, /cycle 9 ends[\s\S]*running for 2 h, the app lets the turn in flight finish[\s\S]*2 h left[\s\S]*autonomous/)
  h.turn(id, { thread: 'thread-a' })
  t.mock.timers.tick(30 * MINUTE)
  await h.flush()
  assert.match(h.sent[1]!, /^chat-1:Cycle 2\..*The time limit has 1 h 30 min left\.$/)
  h.turn(id, { thread: 'thread-b' })
  t.mock.timers.tick(AGENT_RUN_CONTINUE_DELAY_MS)
  await h.flush()
  assert.match(h.sent[2]!, /context was rotated[\s\S]*Go\.\n\nRun settings[\s\S]*1 h 30 min left[\s\S]*Start cycle 3 now/)
  h.service.stop()
})
