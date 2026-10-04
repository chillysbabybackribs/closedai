import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_OPTIMIZE_CANCELLED, type AgentOptimizeRequest } from '../../shared/agent-optimizer.js'
import type { EphemeralModelRequest } from '../ephemeral-model/ephemeral-request.js'
import { AgentPromptOptimizer } from './prompt-optimizer.js'

const request = (patch: Partial<AgentOptimizeRequest> = {}): AgentOptimizeRequest => ({
  requestId: 'r1', description: 'Keep docs/ in step with src/, one page per cycle.', paneId: 'pane-1', name: '',
  maxCycles: null, maxMinutes: null, autonomous: true, ...patch
})
const REPLY = '<name>Docs sweep</name><max_cycles>30</max_cycles><max_minutes>none</max_minutes><assumptions>\n- It does not commit.\n</assumptions><prompt>\nYou keep docs current.\n</prompt>'

test('optimizing asks the launching pane\'s model at high effort and returns the parsed result', async () => {
  const seen: EphemeralModelRequest[] = []
  const optimizer = new AgentPromptOptimizer({
    modelFor: (paneId) => paneId === 'pane-1' ? 'claude:opus' : null,
    request: async (sent) => { seen.push(sent); return REPLY }
  })
  const result = await optimizer.optimize(request({ maxMinutes: 60, autonomous: false }))
  assert.deepEqual(result, { name: 'Docs sweep', prompt: 'You keep docs current.', maxCycles: 30, maxMinutes: null, assumptions: ['It does not commit.'], modelId: 'claude:opus' })
  assert.equal(seen.length, 1)
  assert.equal(seen[0]!.modelId, 'claude:opus')
  assert.equal(seen[0]!.effort, 'high')
  assert.match(seen[0]!.prompt, /Keep docs\/ in step with src\/, one page per cycle\./)
  assert.match(seen[0]!.prompt, /Autonomy: supervised/)
  assert.match(seen[0]!.instructions, /how_a_run_works/)
})

test('a request is refused before any model call when there is nothing to optimize or no model to ask', async () => {
  let calls = 0
  const optimizer = new AgentPromptOptimizer({ modelFor: (paneId) => paneId === 'pane-1' ? 'gpt-5' : null, request: async () => { calls += 1; return REPLY } })
  await assert.rejects(optimizer.optimize(request({ description: '  docs  ' })), /Describe what the agent should do/)
  await assert.rejects(optimizer.optimize(request({ paneId: 'closed' })), /Select a chat with a model first/)
  await assert.rejects(optimizer.optimize(request({ description: 'x'.repeat(9_000) })), /limited to/)
  assert.equal(calls, 0)
})

test('cancel aborts the request in flight and rejects as cancelled; a provider failure keeps its own message', async () => {
  let aborted = false
  const optimizer = new AgentPromptOptimizer({
    modelFor: () => 'gpt-5',
    request: (_sent, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('Optimizing the instructions did not complete')) })
    })
  })
  const pending = optimizer.optimize(request())
  optimizer.cancel('r1')
  await assert.rejects(pending, new RegExp(AGENT_OPTIMIZE_CANCELLED))
  assert.equal(aborted, true)
  optimizer.cancel('r1')
  const failing = new AgentPromptOptimizer({ modelFor: () => 'gpt-5', request: async () => { throw new Error('Optimizing the instructions failed') } })
  await assert.rejects(failing.optimize(request()), /Optimizing the instructions failed\. Check that this chat's provider is signed in; nothing was changed\./)
  const chatty = new AgentPromptOptimizer({ modelFor: () => 'gpt-5', request: async () => 'Sure! Here is a plan.' })
  await assert.rejects(chatty.optimize(request()), /replied without instructions/)
})

test('a request that outlasts the time limit is abandoned with a message that says the text is safe', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const optimizer = new AgentPromptOptimizer({
    modelFor: () => 'gpt-5', timeoutMs: 120_000,
    request: (_sent, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('stopped'))) })
  })
  const pending = optimizer.optimize(request())
  t.mock.timers.tick(120_000)
  await assert.rejects(pending, /did not answer within 2 minutes\. Your description is unchanged/)
})
