import assert from 'node:assert/strict'
import test from 'node:test'

import { ToolRegistry } from '../registry.js'
import { textResult, type JsonObject, type ToolNamespace, type ToolResult } from '../tool.js'
import { batchTools } from './index.js'
import { compensationFor, releases } from './compensation.js'

const context = { threadId: 't', turnId: 'u', callId: 'c' }

/** The three tools that arm invisible tab state, plus something that fails on demand. */
function harness(): { registry: ToolRegistry; log: string[] } {
  const log: string[] = []
  const verbTool = (name: string, verbs: string[]) => ({
    name,
    description: `Test ${name}`,
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string', enum: verbs }, tab_id: { type: 'string' } },
      required: ['action']
    } as JsonObject,
    run: async (input: JsonObject) => {
      log.push(`${name}.${String(input.action)}${input.tab_id ? `:${String(input.tab_id)}` : ''}`)
      return textResult('ok')
    }
  })
  const browser: ToolNamespace = {
    name: 'browser_cdp',
    description: 'Browser',
    tools: [
      verbTool('profile', ['start', 'stop', 'metrics']),
      verbTool('instrument', ['hook', 'recording', 'unhook']),
      verbTool('emulate', ['apply', 'reset']),
      {
        name: 'page',
        description: 'Fails on demand.',
        inputSchema: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] },
        run: async () => {
          log.push('page.failed')
          return { content: [{ type: 'text', text: 'renderer crashed' }], isError: true }
        }
      }
    ]
  }
  let registry: ToolRegistry
  registry = new ToolRegistry([browser, batchTools(() => registry)])
  return { registry, log }
}

function run(registry: ToolRegistry, args: unknown): Promise<ToolResult> {
  return registry.call({ namespace: 'tool_batch', tool: 'run', arguments: args }, context)
}

function text(result: ToolResult): string {
  return result.content.flatMap((item) => item.type === 'text' ? [item.text] : []).join('\n')
}

test('a failed plan releases the browser state its earlier steps armed', async () => {
  const { registry, log } = harness()
  const result = await run(registry, {
    calls: [
      { tool: 'browser_cdp.profile', arguments: { action: 'start', tab_id: 'tab-9' } },
      { tool: 'browser_cdp.instrument', arguments: { action: 'hook', tab_id: 'tab-9' } },
      { tool: 'browser_cdp.page', arguments: { action: 'navigate' } },
      { tool: 'browser_cdp.profile', arguments: { action: 'stop', tab_id: 'tab-9' } }
    ]
  })

  // Released in reverse order, so the recorder installed last is removed first.
  assert.deepEqual(log, [
    'profile.start:tab-9',
    'instrument.hook:tab-9',
    'page.failed',
    'instrument.unhook:tab-9',
    'profile.stop:tab-9'
  ])
  assert.match(text(result), /Unwound after the failure/)
  assert.match(text(result), /profiling recorders on tab-9 — released/)
})

test('state the plan already released on purpose is not released twice', async () => {
  const { registry, log } = harness()
  await run(registry, {
    calls: [
      { tool: 'browser_cdp.emulate', arguments: { action: 'apply', tab_id: 'tab-2' } },
      { tool: 'browser_cdp.emulate', arguments: { action: 'reset', tab_id: 'tab-2' } },
      { tool: 'browser_cdp.page', arguments: { action: 'navigate' } }
    ]
  })
  assert.deepEqual(log, ['emulate.apply:tab-2', 'emulate.reset:tab-2', 'page.failed'])
})

test('a batch that succeeds keeps what it armed, because that was the point of arming it', async () => {
  const { registry, log } = harness()
  await run(registry, {
    calls: [{ tool: 'browser_cdp.profile', arguments: { action: 'start', tab_id: 'tab-3' } }]
  })
  assert.deepEqual(log, ['profile.start:tab-3'])
})

test('parallel calls are declared independent, so one failure does not unwind the others', async () => {
  const { registry, log } = harness()
  await run(registry, {
    parallel: true,
    calls: [
      { tool: 'browser_cdp.profile', arguments: { action: 'start', tab_id: 'tab-4' } },
      { tool: 'browser_cdp.page', arguments: { action: 'navigate' } }
    ]
  })
  assert.ok(!log.includes('profile.stop:tab-4'))
})

test('compensation covers armed state only, and follows the tab it was armed on', () => {
  assert.equal(compensationFor({ namespace: 'browser_cdp', tool: 'profile', arguments: { action: 'metrics' } }), null)
  assert.equal(compensationFor({ namespace: 'embedded_browser', tool: 'page', arguments: { action: 'navigate' } }), null)
  // A tab that was opened, or a cookie written, is a visible decision rather than bookkeeping.
  assert.equal(compensationFor({ namespace: 'closedai_app', tool: 'command', arguments: { action: 'browser_tab' } }), null)

  const active = compensationFor({ namespace: 'browser_cdp', tool: 'instrument', arguments: { action: 'hook' } })
  assert.deepEqual(active?.call, { namespace: 'browser_cdp', tool: 'instrument', arguments: { action: 'unhook' } })
  assert.match(String(active?.label), /the active tab/)

  const armed = compensationFor({ namespace: 'browser_cdp', tool: 'profile', arguments: { action: 'start', tab_id: 'tab-1' } })!
  assert.ok(releases({ namespace: 'browser_cdp', tool: 'profile', arguments: { action: 'stop', tab_id: 'tab-1' } }, armed))
  // A stop aimed at a different tab settles nothing.
  assert.ok(!releases({ namespace: 'browser_cdp', tool: 'profile', arguments: { action: 'stop', tab_id: 'tab-2' } }, armed))
  assert.ok(!releases({ namespace: 'browser_cdp', tool: 'instrument', arguments: { action: 'unhook', tab_id: 'tab-1' } }, armed))
})
