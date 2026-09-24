import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_RUN_MAX_FAILURES, type AgentRun } from '../../shared/agent-runs.js'
import { DOCK_CLOSED, dockSummary, dockTiles, dockVisible, reduceDock, type DockReveal } from './agent-dock-model.ts'

const run = (patch: Partial<AgentRun> = {}): AgentRun => ({ chatId: 'c1', prompt: 'Go.', status: 'running', cycle: 3, maxCycles: null,
  startedAt: 1, updatedAt: 10, lastTurnEndedAt: null, reason: null, failures: 0, threadId: null, agentId: null, name: 'Brief', ...patch })

test('a running tile shows the live activity of its chat, or that the next cycle is starting', () => {
  const [busy] = dockTiles([run()], [{ paneId: 'c1', running: true, activity: 'Reading docs' }], [])
  assert.equal(busy!.state, 'running')
  assert.equal(busy!.detail, 'Reading docs')
  assert.equal(busy!.cycleLabel, 'Cycle 3')
  assert.equal(busy!.attentionKey, null)
  const [idle] = dockTiles([run({ maxCycles: 5 })], [{ paneId: 'c1', running: false, activity: null }], [])
  assert.equal(idle!.detail, 'Starting the next cycle')
  assert.equal(idle!.cycleLabel, 'Cycle 3 of 5')
})

test('failure pauses, finished limits, and credential approvals need the user; retries and user pauses do not', () => {
  const tiles = dockTiles([
    run({ chatId: 'fail', status: 'paused', failures: AGENT_RUN_MAX_FAILURES, reason: '5 turns in a row failed. Last: x' }),
    run({ chatId: 'done', status: 'paused', cycle: 5, maxCycles: 5, reason: 'Reached 5 cycles' }),
    run({ chatId: 'ask' }),
    run({ chatId: 'retry', failures: 2, reason: 'Retry 2 of 4 in 8s: x' }),
    run({ chatId: 'held', status: 'paused', reason: 'Paused from the dock' })
  ], [], [{ id: 'r1', paneId: 'ask', credentialLabel: 'GitHub' }])
  const byId = Object.fromEntries(tiles.map((tile) => [tile.chatId, tile]))
  assert.deepEqual(tiles.map((tile) => tile.chatId), ['ask', 'fail', 'done', 'retry', 'held'])
  assert.equal(byId.ask!.state, 'approval')
  assert.equal(byId.ask!.detail, 'Asking to read GitHub')
  assert.equal(byId.fail!.state, 'failed')
  assert.equal(byId.done!.state, 'finished')
  assert.equal(byId.retry!.state, 'retrying')
  assert.equal(byId.held!.state, 'paused')
  assert.ok(byId.ask!.attentionKey && byId.fail!.attentionKey && byId.done!.attentionKey)
  assert.equal(byId.retry!.attentionKey, null)
  assert.equal(byId.held!.attentionKey, null)
  assert.equal(dockSummary(tiles), '1 running · 3 need you · 1 paused')
  assert.equal(dockSummary([]), 'No agents running')
})

test('the dock opens itself for new attention and stays open until the user has looked', () => {
  let reveal: DockReveal = DOCK_CLOSED
  assert.equal(dockVisible(reveal, []), false)
  assert.equal(dockVisible(reveal, ['c1:failed:10']), true)
  reveal = reduceDock(reveal, { type: 'look' }, ['c1:failed:10'])
  assert.equal(dockVisible(reveal, ['c1:failed:10']), true, 'looking holds it open under the pointer')
  reveal = reduceDock(reveal, { type: 'leave' }, ['c1:failed:10'])
  assert.equal(dockVisible(reveal, ['c1:failed:10']), false)
  assert.equal(dockVisible(reveal, ['c1:failed:10', 'c2:finished:20']), true, 'a new reason announces again')
})

test('a rest or click opens it, leaving closes it unless pinned, and Escape closes and unpins', () => {
  let reveal = reduceDock(DOCK_CLOSED, { type: 'open' }, [])
  assert.equal(dockVisible(reveal, []), true)
  reveal = reduceDock(reveal, { type: 'leave' }, [])
  assert.equal(dockVisible(reveal, []), false)
  reveal = reduceDock(reveal, { type: 'toggle' }, [])
  reveal = reduceDock(reveal, { type: 'pin' }, [])
  reveal = reduceDock(reveal, { type: 'leave' }, [])
  assert.equal(dockVisible(reveal, []), true, 'pinned survives the pointer leaving')
  reveal = reduceDock(reveal, { type: 'escape' }, [])
  assert.deepEqual(reveal, DOCK_CLOSED)
  reveal = reduceDock(reduceDock(DOCK_CLOSED, { type: 'toggle' }, []), { type: 'toggle' }, [])
  assert.equal(dockVisible(reveal, []), false, 'a second click closes')
})

test('seen attention is pruned once its run no longer needs the user', () => {
  const reveal = reduceDock(DOCK_CLOSED, { type: 'escape' }, ['c1:failed:10'])
  assert.deepEqual(reveal.seen, ['c1:failed:10'])
  assert.deepEqual(reduceDock(reveal, { type: 'open' }, []).seen, [])
})
