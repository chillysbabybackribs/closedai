import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolRegistry } from '../registry.js'
import { cdpTools } from './index.js'
import type { CdpToolHost } from './host.js'

function harness(overrides: Partial<CdpToolHost> = {}) {
  const calls: unknown[] = []
  const host: CdpToolHost = {
    capabilities: async (tabId) => { calls.push(['capabilities', tabId]); return { protocolVersion: '1.3' } },
    targets: async (tabId) => { calls.push(['targets', tabId]); return { targets: [] } },
    command: async (tabId, method, params, sessionId) => {
      calls.push(['command', tabId, method, params, sessionId])
      return { result: { value: 4 } }
    },
    events: (tabId, after, limit, prefix) => {
      calls.push(['events', tabId, after, limit, prefix])
      return { tab: {}, connectionId: 'c1', oldestCursor: 1, nextCursor: 2, missedEvents: false, events: [] }
    },
    ...overrides
  }
  const registry = new ToolRegistry([cdpTools(() => host)])
  const call = (arguments_: Record<string, unknown>) => registry.call(
    { namespace: 'browser_cdp', tool: 'protocol', arguments: arguments_ },
    { threadId: null, turnId: null, callId: 'call-1' }
  )
  return { calls, call, registry }
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.type === 'text' ? result.content[0].text ?? '' : ''
}

test('CDP tool advertises the four foundational protocol actions', () => {
  const { registry } = harness()
  assert.deepEqual(registry.names(), ['browser_cdp.protocol'])
  assert.deepEqual(registry.namespaces[0].tools[0].actions?.map((action) => action.name), [
    'capabilities', 'targets', 'command', 'events'
  ])
})

test('capabilities and targets default to the active ClosedAI tab', async () => {
  const { calls, call } = harness()
  assert.match(textOf(await call({ action: 'capabilities' })), /"protocolVersion": "1.3"/)
  await call({ action: 'targets', tab_id: 'tab-4' })
  assert.deepEqual(calls, [['capabilities', undefined], ['targets', 'tab-4']])
})

test('command passes arbitrary params and a flat child session id', async () => {
  const { calls, call } = harness()
  const result = await call({
    action: 'command',
    tab_id: 'tab-2',
    method: 'Runtime.evaluate',
    params: { expression: '2 + 2', awaitPromise: true },
    session_id: 'child-8'
  })
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls[0], [
    'command', 'tab-2', 'Runtime.evaluate', { expression: '2 + 2', awaitPromise: true }, 'child-8'
  ])
})

test('events use cursor defaults and accept method-prefix filtering', async () => {
  const { calls, call } = harness()
  await call({ action: 'events', method_prefix: 'Network.' })
  assert.deepEqual(calls[0], ['events', undefined, 0, 100, 'Network.'])
})

test('command validates CDP method syntax and action-specific fields', async () => {
  const { call } = harness()
  const invalidMethod = await call({ action: 'command', method: 'evaluate' })
  assert.equal(invalidMethod.isError, true)
  assert.match(textOf(invalidMethod), /Domain\.method syntax/)

  const wrongField = await call({ action: 'targets', params: {} })
  assert.equal(wrongField.isError, true)
  assert.match(textOf(wrongField), /not a recognised argument/)
})
