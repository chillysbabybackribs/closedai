import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyAgentRunStats, type AgentRun, type AgentRunStats } from '../../shared/agent-runs.js'
import { agentRunBrief } from './agent-run-brief.ts'

const NOW = 1_000_000
const run = (patch: Partial<AgentRun> = {}, stats: Partial<AgentRunStats> = {}): AgentRun => ({
  chatId: 'c1', prompt: 'Go.', status: 'running', cycle: 4, maxCycles: 10, startedAt: NOW - 3_600_000, updatedAt: NOW,
  lastTurnEndedAt: NOW - 95_000, reason: null, failures: 0, threadId: 't', agentId: null, name: 'Repair agent',
  stats: { ...emptyAgentRunStats(), ...stats }, ...patch })
const texts = (lines: ReturnType<typeof agentRunBrief>): Record<string, string> => Object.fromEntries(lines.map((line) => [line.kind, line.text]))

test('a live cycle says how long it has worked, what the run has done, and what each cycle costs', () => {
  const lines = texts(agentRunBrief(run({}, {
    steps: 12, edits: 3, turnMs: 600_000, turnStartedAt: NOW - 80_000, rotations: 1,
    lastMessage: 'Fixed the flaky test and reran the suite.',
    context: { usedTokens: 61_000, contextWindow: 200_000, percent: 31 },
    plan: { plan: 'Pro', windows: [{ label: '5-hour', percent: 42, resetsAt: NOW + 7_200_000 }, { label: 'Weekly', percent: 12, resetsAt: null }], note: null, unavailable: null, updatedAt: NOW }
  }), NOW))
  assert.equal(lines.progress, 'Cycle 4 of 10 has been working 1m 20s. 12 steps including 3 file edits over 11m 20s of model time.')
  assert.equal(lines.reply, 'Last reply: “Fixed the flaky test and reran the suite.”')
  assert.equal(lines.cost, 'Each cycle re-sends 61.0k tokens of context (31% of the 200k window), growing with every step. ' +
    'The context was rotated once, re-sending the instructions each time. 5-hour plan window at 42%, resets in 2h; Weekly plan window at 12%.')
  assert.equal(lines.error, undefined, 'no error line without errors')
})

test('between cycles and when paused the brief counts finished cycles; errors get their own line; a hot context warns', () => {
  const idle = texts(agentRunBrief(run({}, { steps: 2, errors: 1, lastError: 'npm test exited with code 1' }), NOW))
  assert.equal(idle.progress, '3 cycles finished, the last 1m ago. 2 steps.')
  assert.equal(idle.cost, 'The provider has not reported context usage yet.')
  assert.equal(idle.error, '1 error across 2 steps. Last: npm test exited with code 1')
  const paused = texts(agentRunBrief(run({ status: 'paused', cycle: 1, lastTurnEndedAt: NOW - 20_000 }, { turnMs: 5_000 }), NOW))
  assert.equal(paused.progress, '1 cycle finished, the last 20s ago. No commands, edits or tool calls yet over 5.0s of model time.')
  const fresh = texts(agentRunBrief(run({ cycle: 1, lastTurnEndedAt: null }), NOW))
  assert.equal(fresh.progress, 'No cycle has finished yet.')
  const hot = texts(agentRunBrief(run({}, { context: { usedTokens: 160_000, contextWindow: 200_000, percent: 80 } }), NOW))
  assert.match(hot.cost!, /80% of the 200k window, a rotation is near\)/)
  const clipped = texts(agentRunBrief(run({}, { lastMessage: 'x'.repeat(200) }), NOW))
  assert.equal(clipped.reply!.length, 'Last reply: “”'.length + 140)
})
