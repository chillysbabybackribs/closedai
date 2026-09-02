import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolRegistry } from '../registry.js'
import { appTools } from './index.js'
import type { AppToolHost } from './host.js'

function harness(overrides: Partial<AppToolHost> = {}) {
  const calls: unknown[] = []
  const host: AppToolHost = {
    inspect: async (maxElements) => {
      calls.push(['inspect', maxElements])
      return { snapshotId: 'p1', elements: [] }
    },
    click: async (ref) => {
      calls.push(['click', ref])
      return { ref, point: { x: 10, y: 20 } }
    },
    typeText: async (ref, text, clear) => {
      calls.push(['typeText', ref, text, clear])
      return { ref, value: text }
    },
    pressKey: async (key, modifiers) => {
      calls.push(['pressKey', key, modifiers])
      return { key, modifiers }
    },
    scroll: async (ref, deltaX, deltaY) => {
      calls.push(['scroll', ref, deltaX, deltaY])
      return { scrolled: ref ? 'into_view' : 'wheel' }
    },
    waitFor: async (options, signal) => {
      calls.push(['waitFor', options, signal.aborted])
      return {
        ...options,
        reached: true,
        elapsedMs: 75,
        selectorMatched: options.selector ? options.condition === 'visible' : null,
        textMatched: options.text ? options.condition === 'visible' : null
      }
    },
    ...overrides
  }
  const registry = new ToolRegistry([appTools(() => host)])
  const call = (arguments_: Record<string, unknown>) => registry.call(
    { namespace: 'closedai_app', tool: 'page', arguments: arguments_ },
    { threadId: null, turnId: null, callId: 'app-call' }
  )
  return { calls, call, registry }
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.type === 'text' ? result.content[0].text ?? '' : ''
}

test('app tool advertises the semantic renderer actions', () => {
  const { registry } = harness()
  assert.deepEqual(registry.names(), ['closedai_app.page'])
  assert.deepEqual(registry.namespaces[0]!.tools[0]!.actions?.map((action) => action.name), [
    'inspect_app', 'click', 'type', 'press_key', 'scroll', 'wait_for'
  ])
})

test('inspect and ref actions route to the app host with safe defaults', async () => {
  const { calls, call } = harness()
  assert.match(textOf(await call({ action: 'inspect_app' })), /"snapshotId": "p1"/)
  await call({ action: 'click', ref: 'p1:main:e1' })
  await call({ action: 'type', ref: 'p1:main:e2', text: 'hello' })
  await call({ action: 'press_key', key: 'Enter', modifiers: ['ctrl'] })
  await call({ action: 'scroll', delta_y: 400 })
  assert.deepEqual(calls, [
    ['inspect', 200],
    ['click', 'p1:main:e1'],
    ['typeText', 'p1:main:e2', 'hello', true],
    ['pressKey', 'Enter', ['ctrl']],
    ['scroll', undefined, 0, 400]
  ])
})

test('wait forwards conditions and marks a timeout as a tool failure', async () => {
  const timedOut: AppToolHost['waitFor'] = async (options) => ({
    ...options,
    reached: false,
    elapsedMs: options.timeoutMs,
    selectorMatched: false,
    textMatched: null
  })
  const { calls, call } = harness({ waitFor: timedOut })
  const missingCondition = await call({ action: 'wait_for' })
  assert.equal(missingCondition.isError, true)
  assert.match(textOf(missingCondition), /selector.*wait_for_text/)

  const result = await call({
    action: 'wait_for', selector: '[role="dialog"]', condition: 'hidden', timeout_ms: 250
  })
  assert.equal(result.isError, true)
  assert.match(textOf(result), /"reached": false/)
  assert.deepEqual(calls, [])
})

test('wait succeeds with default condition and timeout', async () => {
  const { calls, call } = harness()
  const result = await call({ action: 'wait_for', wait_for_text: 'Tools' })
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls[0], [
    'waitFor',
    { selector: undefined, text: 'Tools', condition: 'visible', timeoutMs: 3_000 },
    false
  ])
})

test('action schemas reject stale-shaped and oversized arguments before dispatch', async () => {
  const { calls, call } = harness()
  const missingRef = await call({ action: 'click' })
  assert.equal(missingRef.isError, true)
  const badModifier = await call({ action: 'press_key', key: 'Enter', modifiers: ['hyper'] })
  assert.equal(badModifier.isError, true)
  const badTimeout = await call({ action: 'wait_for', wait_for_text: 'x', timeout_ms: 30_000 })
  assert.equal(badTimeout.isError, true)
  assert.deepEqual(calls, [])
})
