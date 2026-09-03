import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import { createToolRegistry } from '../tools/index.js'
import { defineTool, textResult } from '../tools/tool.js'
import type { ToolCallEvent } from '../../shared/tools.js'
import { claudeMcpServers, claudeToolResult, toolUseIdOf } from './claude-tools.js'

type Registered = {
  name: string
  description: string
  shape: Record<string, unknown>
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>
  extras: { alwaysLoad?: boolean } | undefined
}

function fakeSdk(): { sdk: Parameters<typeof claudeMcpServers>[0]; servers: Array<{ name: string; instructions?: string; tools: Registered[] }> } {
  const servers: Array<{ name: string; instructions?: string; tools: Registered[] }> = []
  const sdk = {
    tool: ((name: string, description: string, shape: Record<string, unknown>, handler: Registered['handler'], extras?: Registered['extras']) => (
      { name, description, shape, handler, extras } as unknown
    )) as never,
    createSdkMcpServer: ((options: { name: string; instructions?: string; tools?: unknown[] }) => {
      servers.push({ name: options.name, instructions: options.instructions, tools: (options.tools ?? []) as Registered[] })
      return { type: 'sdk', name: options.name, instance: {} } as unknown
    }) as never
  } as unknown as Parameters<typeof claudeMcpServers>[0]
  return { sdk, servers }
}

function registry(): ReturnType<typeof createToolRegistry> {
  return createToolRegistry([{
    name: 'embedded_browser',
    description: 'The embedded browser.',
    tools: [
      defineTool({
        name: 'page',
        description: 'Read pages.',
        inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['read'] }, echo: { type: 'string' } }, required: ['action'], additionalProperties: false },
        async run(input) {
          if (input.echo === 'fail') return { content: [{ type: 'text', text: 'nope' }], isError: true }
          return { content: [{ type: 'text', text: `read:${String(input.echo ?? '')}` }, { type: 'image', dataUrl: 'data:image/png;base64,QUJD' }] }
        }
      }),
      defineTool({
        name: 'protocol',
        description: 'Raw access.',
        deferLoading: true,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        async run() { return textResult('ok') }
      })
    ]
  }])
}

test('one MCP server per namespace, tools always-loaded unless the registry defers them', () => {
  const { sdk, servers } = fakeSdk()
  const built = claudeMcpServers(sdk, registry(), () => ({ threadId: null, turnId: null }))
  assert.deepEqual(Object.keys(built), ['embedded_browser'])
  assert.equal(servers[0]!.instructions, 'The embedded browser.')
  assert.deepEqual(servers[0]!.tools.map((tool) => [tool.name, tool.extras?.alwaysLoad]), [['page', true], ['protocol', false]])
  assert.equal(z.object(servers[0]!.tools[0]!.shape as never).safeParse({ action: 'read' }).success, true)
})

test('disabled tools are not advertised', () => {
  const { sdk, servers } = fakeSdk()
  const tools = registry()
  tools.setEnabled('embedded_browser.protocol', false)
  claudeMcpServers(sdk, tools, () => ({ threadId: null, turnId: null }))
  assert.deepEqual(servers[0]!.tools.map((tool) => tool.name), ['page'])
})

test('a call runs through the registry and emits aggregate-only telemetry', async () => {
  const { sdk, servers } = fakeSdk()
  const tools = registry()
  const records: ToolCallEvent[] = []
  tools.subscribe((record) => records.push(record))
  claudeMcpServers(sdk, tools, () => ({ threadId: 'claude:s1', turnId: 'turn-9' }))
  const page = servers[0]!.tools[0]!
  const result = await page.handler({ action: 'read', echo: 'x' }, { _meta: { 'claudecode/toolUseId': 'toolu_42' } }) as { content: unknown[]; isError?: boolean }
  assert.deepEqual(result, { content: [{ type: 'text', text: 'read:x' }, { type: 'image', data: 'QUJD', mimeType: 'image/png' }] })
  assert.deepEqual(records[0], { toolId: 'embedded_browser.page', action: 'read', ok: true, timedOut: false })
  const failed = await page.handler({ action: 'read', echo: 'fail' }, {}) as { isError?: boolean }
  assert.equal(failed.isError, true)
  assert.deepEqual(records[1], { toolId: 'embedded_browser.page', action: 'read', ok: false, timedOut: false })
})

test('invalid arguments come back as a tool error the model can read', async () => {
  const { sdk, servers } = fakeSdk()
  claudeMcpServers(sdk, registry(), () => ({ threadId: null, turnId: null }))
  const result = await servers[0]!.tools[0]!.handler({ action: 'write' }, {}) as { content: Array<{ text: string }>; isError?: boolean }
  assert.equal(result.isError, true)
  assert.match(result.content[0]!.text, /invalid arguments/)
})

test('result and metadata helpers tolerate odd shapes', () => {
  assert.equal(toolUseIdOf(null), null)
  assert.equal(toolUseIdOf({ _meta: { 'claudecode/toolUseId': '' } }), null)
  assert.deepEqual(claudeToolResult({ content: [{ type: 'image', dataUrl: 'not-a-data-url' }] }), { content: [{ type: 'text', text: '[image could not be encoded]' }] })
})
