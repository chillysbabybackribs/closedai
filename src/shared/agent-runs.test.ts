import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AGENT_RUN_MAX_MINUTES, agentCycleMessage, agentRunLimitReached, agentRunRemainingMs, agentRunSettingsNote, cleanMaxMinutes,
  describeAgentRunRemaining, agentRunExcerpt, formatAgentMinutes, normalizeAgentRun
} from './agent-runs.js'

test('run excerpts flatten markdown but keep identifiers intact', () => {
  assert.equal(agentRunExcerpt('closedai_app.ui: input must run inside tool_batch.run'),
    'closedai_app.ui: input must run inside tool_batch.run')
  assert.equal(agentRunExcerpt('## Done\n- **Fixed** the _flaky_ `test_one` __run__'), 'Done Fixed the flaky test_one run')
  assert.equal(agentRunExcerpt('```\ncode\n```'), null)
  assert.equal(agentRunExcerpt('abcdefghij', 5), 'abcd…')
})

test('time limits read as minutes and hours, and only whole positive minutes are a limit', () => {
  assert.equal(formatAgentMinutes(45), '45 min')
  assert.equal(formatAgentMinutes(120), '2 h')
  assert.equal(formatAgentMinutes(90), '1 h 30 min')
  assert.equal(cleanMaxMinutes(30), 30)
  assert.equal(cleanMaxMinutes(0), null)
  assert.equal(cleanMaxMinutes(2.5), null)
  assert.equal(cleanMaxMinutes('30'), null)
  assert.equal(cleanMaxMinutes(AGENT_RUN_MAX_MINUTES * 4), AGENT_RUN_MAX_MINUTES)
})

test('remaining time counts the banked spans plus the live one, and stops while paused', () => {
  const MINUTE = 60_000
  const running = { maxMinutes: 60, activeMs: 10 * MINUTE, activeSince: 100 * MINUTE }
  assert.equal(agentRunRemainingMs(running, 120 * MINUTE), 30 * MINUTE)
  assert.equal(describeAgentRunRemaining(running, 120 * MINUTE + 1), '30 min left', 'a started minute still shows')
  assert.equal(agentRunRemainingMs(running, 900 * MINUTE), 0)
  const paused = { maxMinutes: 60, activeMs: 10 * MINUTE, activeSince: null }
  assert.equal(agentRunRemainingMs(paused, 900 * MINUTE), 50 * MINUTE)
  assert.equal(agentRunRemainingMs({ ...paused, maxMinutes: null }, 0), null)
  assert.equal(describeAgentRunRemaining({ ...paused, maxMinutes: null }, 0), null)
  const reached = { status: 'paused' as const, cycle: 3, maxCycles: null, maxMinutes: 60, activeMs: 60 * MINUTE, activeSince: null }
  assert.equal(agentRunLimitReached({ ...reached, reason: 'Reached 1 h' }), true)
  assert.equal(agentRunLimitReached({ ...reached, reason: 'Paused by you' }), false)
  assert.equal(agentRunLimitReached({ ...reached, maxMinutes: null, maxCycles: 3, reason: 'Reached 3 cycles' }), true)
})

test('a run with today\'s defaults is sent its instructions unchanged; any setting adds the settings note', () => {
  const plain = { maxCycles: null, maxMinutes: null, activeMs: 0, activeSince: null, autonomous: true }
  assert.equal(agentRunSettingsNote(plain, 0), '')
  assert.equal(agentCycleMessage({ prompt: 'Go.', cycle: 0 }, false), 'Go.')
  assert.equal(agentCycleMessage({ prompt: 'Go.', cycle: 0, ...plain }, false), 'Go.')
  const supervised = agentRunSettingsNote({ ...plain, autonomous: false }, 0)
  assert.match(supervised, /Limits: none/)
  assert.match(supervised, /supervised; the app pauses this run after every cycle/)
  assert.doesNotMatch(agentCycleMessage({ prompt: 'Go.', cycle: 3, ...plain, maxCycles: 5 }, false), /time limit/i)
})

test('a run saved before the settings existed loads autonomous with no time limit', () => {
  const old = normalizeAgentRun({ prompt: 'Go.', status: 'running', cycle: 2, maxCycles: 4, startedAt: 10, updatedAt: 40 }, 'c1')!
  assert.equal(old.autonomous, true)
  assert.equal(old.maxMinutes, null)
  assert.equal(old.activeMs, 0)
  assert.equal(old.activeSince, 40, 'a running record without a clock counts from its last write')
  const kept = normalizeAgentRun({ prompt: 'Go.', status: 'paused', maxMinutes: 90, activeMs: 1200, activeSince: 5, autonomous: false }, 'c1')!
  assert.deepEqual([kept.maxMinutes, kept.activeMs, kept.activeSince, kept.autonomous], [90, 1200, null, false])
})
