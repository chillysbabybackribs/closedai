import assert from 'node:assert/strict'
import test from 'node:test'
import { defineActionTool, type ToolAction } from './action-tool.js'
import { ToolRegistry } from './registry.js'
import { textResult, type ToolContext } from './tool.js'

const context: ToolContext = { threadId: 't', turnId: 'u', callId: 'c', signal: new AbortController().signal }

const search: ToolAction = {
  action: 'search',
  description: 'Search a provider. Returns a list of hits.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, description: 'Search terms.' },
      limit: { type: 'integer', minimum: 1, maximum: 50 }
    },
    required: ['query'],
    additionalProperties: false
  },
  run: async (input) => textResult(`searched ${String(input.query)} x${String(input.limit ?? 10)}`)
}

const fetch: ToolAction = {
  action: 'fetch',
  description: 'Fetch one result by id.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } },
    required: ['id'],
    additionalProperties: false
  },
  timeoutMs: 5_000,
  run: async (input) => textResult(`fetched ${String(input.id)}`)
}

test('defineActionTool assembles one description with a section per action', () => {
  const tool = defineActionTool({ name: 'web', description: 'Web lookups.', actions: [search, fetch] })
  assert.match(tool.description, /^Web lookups\./)
  assert.match(tool.description, /- `search`: Search a provider/)
  assert.match(tool.description, /- `fetch`: Fetch one result by id/)
  assert.deepEqual(tool.actions?.map((action) => action.name), ['search', 'fetch'])
  assert.equal(tool.timeoutMs, 5_000)
})

test('defineActionTool advertises a flat schema with an action enum and field notes', () => {
  const tool = defineActionTool({ name: 'web', description: 'Web lookups.', actions: [search, fetch] })
  const properties = tool.inputSchema.properties as Record<string, Record<string, unknown>>
  assert.deepEqual(tool.inputSchema.required, ['action'])
  assert.deepEqual(properties.action.enum, ['search', 'fetch'])
  assert.equal(properties.query.description, 'Search terms. Required for: search.')
  assert.equal(properties.id.description, 'Required for: fetch.')
  assert.equal(properties.limit.description, undefined)
})

test('action tool validates against the chosen action only', async () => {
  const tool = defineActionTool({ name: 'web', description: 'Web lookups.', actions: [search, fetch] })
  const ok = await tool.run({ action: 'search', query: 'cats' }, context)
  assert.deepEqual(ok, textResult('searched cats x10'))

  const missing = await tool.run({ action: 'fetch' }, context)
  assert.equal(missing.isError, true)
  assert.match(missing.content[0].type === 'text' ? missing.content[0].text : '', /web\.fetch: invalid arguments — \$\.id is required/)

  const wrongField = await tool.run({ action: 'fetch', id: '1', query: 'x' }, context)
  assert.equal(wrongField.isError, true)

  const unknown = await tool.run({ action: 'delete' }, context)
  assert.equal(unknown.isError, true)
  assert.match(unknown.content[0].type === 'text' ? unknown.content[0].text : '', /"delete" is not one of search, fetch/)

  const typo = await tool.run({ action: 'fetc' }, context)
  assert.equal(typo.isError, true)
  assert.match(typo.content[0].type === 'text' ? typo.content[0].text : '', /"fetc" is not one of search, fetch \(did you mean "fetch"\?\)/)
})

test('action tool runs end to end through the registry', async () => {
  const registry = new ToolRegistry([{
    name: 'web',
    description: 'Web tools',
    tools: [defineActionTool({ name: 'lookup', description: 'Web lookups.', actions: [search, fetch] })]
  }])
  const result = await registry.call({ namespace: 'web', tool: 'lookup', arguments: { action: 'fetch', id: '42' } }, { threadId: null, turnId: null, callId: 'c' })
  assert.deepEqual(result, textResult('fetched 42'))
  const rejected = await registry.call({ namespace: 'web', tool: 'lookup', arguments: { query: 'no action' } }, { threadId: null, turnId: null, callId: 'c' })
  assert.equal(rejected.isError, true)
})

test('defineActionTool refuses conflicting field schemas, duplicates, and too many actions', () => {
  const conflicting: ToolAction = { ...fetch, action: 'other', inputSchema: { type: 'object', properties: { limit: { type: 'string' } } } }
  assert.throws(() => defineActionTool({ name: 'web', description: 'x', actions: [search, conflicting] }), /field "limit" has different schemas/)
  assert.throws(() => defineActionTool({ name: 'web', description: 'x', actions: [search, search] }), /Duplicate action "web.search"/)
  assert.throws(() => defineActionTool({ name: 'web', description: 'x', actions: [search, fetch], maxActions: 1 }), /limit is 1/)
  assert.throws(() => defineActionTool({ name: 'web', description: 'x', actions: [] }), /at least one action/)
  const reserved: ToolAction = { ...fetch, action: 'bad', inputSchema: { type: 'object', properties: { action: { type: 'string' } } } }
  assert.throws(() => defineActionTool({ name: 'web', description: 'x', actions: [reserved] }), /must not define an "action" field/)
})
