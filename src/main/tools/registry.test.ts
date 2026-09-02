import assert from 'node:assert/strict'
import test from 'node:test'
import { dynamicToolSpecs } from './app-server-tools.js'
import { toolManifest } from './manifest.js'
import { defineActionTool } from './action-tool.js'
import { boundResult, MAX_RESULT_TEXT_CHARS, ToolRegistry } from './registry.js'
import { textResult, type ToolNamespace } from './tool.js'

function namespaces(): ToolNamespace[] {
  const echo = (name: string) => ({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    run: async () => textResult(name)
  })
  return [
    { name: 'alpha', description: 'Alpha tools', tools: [echo('one'), echo('two')] },
    { name: 'beta', description: 'Beta tools', tools: [echo('three')] }
  ]
}

const context = { threadId: null, turnId: null, callId: 'c' }

test('switching a tool off hides it from providers and refuses its calls; on restores it', async () => {
  const registry = new ToolRegistry(namespaces())
  assert.deepEqual(registry.setEnabled('alpha.one', false), ['alpha.one'])
  assert.equal(registry.isEnabled('alpha.one'), false)
  assert.equal(registry.isEnabled('alpha.two'), true)

  const specs = dynamicToolSpecs(registry)
  assert.deepEqual(specs.map((spec) => [spec.name, spec.tools.map((tool) => tool.name)]), [['alpha', ['two']], ['beta', ['three']]])

  const refused = await registry.call({ namespace: 'alpha', tool: 'one', arguments: {} }, context)
  assert.equal(refused.isError, true)
  assert.match(refused.content[0].type === 'text' ? refused.content[0].text : '', /switched off/)
  const allowed = await registry.call({ namespace: 'alpha', tool: 'two', arguments: {} }, context)
  assert.deepEqual(allowed, textResult('two'))

  const manifest = toolManifest(registry, ['codex'])
  assert.deepEqual(manifest.namespaces[0].tools.map((tool) => [tool.id, tool.enabled]), [['alpha.one', false], ['alpha.two', true]])

  assert.deepEqual(registry.setEnabled('alpha.one', true), [])
  assert.deepEqual(await registry.call({ namespace: 'alpha', tool: 'one', arguments: {} }, context), textResult('one'))
})

test('switching off every tool in a namespace drops the namespace from the advertised list', () => {
  const registry = new ToolRegistry(namespaces())
  registry.setEnabled('beta.three', false)
  assert.deepEqual(dynamicToolSpecs(registry).map((spec) => spec.name), ['alpha'])
  assert.equal(registry.isEmpty, false)
})

test('unknown tool ids are ignored rather than persisted', () => {
  const registry = new ToolRegistry(namespaces())
  assert.deepEqual(registry.setEnabled('nope.nothing', false), [])
})

test('an action can be switched off on its own: dropped from the advertised tool, refused when called', async () => {
  const lookup = defineActionTool({
    name: 'lookup',
    description: 'Lookups.',
    actions: [
      { action: 'search', description: 'Search.', inputSchema: { type: 'object', properties: { q: { type: 'string' } } }, run: async () => textResult('searched') },
      { action: 'fetch', description: 'Fetch.', inputSchema: { type: 'object', properties: { id: { type: 'string' } } }, run: async () => textResult('fetched') }
    ]
  })
  const registry = new ToolRegistry([{ name: 'web', description: 'Web', tools: [lookup] }])
  assert.deepEqual(registry.switchableIds(), ['web.lookup.search', 'web.lookup.fetch'])

  registry.setEnabled('web.lookup.fetch', false)
  const [spec] = dynamicToolSpecs(registry)
  const advertised = spec.tools[0]
  const properties = advertised.inputSchema as { properties: { action: { enum: string[] }; id?: unknown } }
  assert.deepEqual(properties.properties.action.enum, ['search'])
  assert.equal(properties.properties.id, undefined)
  assert.doesNotMatch(advertised.description, /`fetch`/)

  const refused = await registry.call({ namespace: 'web', tool: 'lookup', arguments: { action: 'fetch', id: '1' } }, context)
  assert.equal(refused.isError, true)
  assert.match(refused.content[0].type === 'text' ? refused.content[0].text : '', /web\.lookup\.fetch is switched off/)
  assert.deepEqual(await registry.call({ namespace: 'web', tool: 'lookup', arguments: { action: 'search', q: 'x' } }, context), textResult('searched'))

  const manifest = toolManifest(registry, ['codex'])
  assert.deepEqual(manifest.namespaces[0].tools[0].actions.map((action) => [action.id, action.enabled]), [['web.lookup.search', true], ['web.lookup.fetch', false]])
  assert.equal(manifest.namespaces[0].tools[0].enabled, true)

  registry.setEnabled('web.lookup.search', false)
  assert.deepEqual(dynamicToolSpecs(registry), [])
  assert.equal(toolManifest(registry, []).namespaces[0].tools[0].enabled, false)
})

test('oversized text results are cut with a hint so one call cannot flood the history', async () => {
  const big = 'x'.repeat(MAX_RESULT_TEXT_CHARS + 500)
  const registry = new ToolRegistry([{
    name: 'gamma',
    description: 'Gamma tools',
    tools: [{
      name: 'dump',
      description: 'dump',
      inputSchema: { type: 'object', properties: {} },
      run: async () => ({ content: [{ type: 'text', text: big }, { type: 'text', text: 'short' }] })
    }]
  }])
  const result = await registry.call({ namespace: 'gamma', tool: 'dump', arguments: {} }, context)
  const first = result.content[0].type === 'text' ? result.content[0].text : ''
  assert.ok(first.startsWith('x'.repeat(MAX_RESULT_TEXT_CHARS)))
  assert.match(first, /\[ClosedAI truncated 500 characters\. Narrow the request/)
  assert.deepEqual(result.content[1], { type: 'text', text: 'short' })
  assert.deepEqual(boundResult(textResult('small')), textResult('small'))
})

test('oversized JSON results shrink structurally so a script can still JSON.parse them', () => {
  const json = JSON.stringify({ items: Array.from({ length: 5_000 }, (_, i) => ({ i, label: 'row' })) })
  const result = boundResult(textResult(json))
  const text = result.content[0].type === 'text' ? result.content[0].text : ''
  assert.ok(text.length <= MAX_RESULT_TEXT_CHARS)
  const parsed = JSON.parse(text) as { _closedai_truncated: string; items: unknown[] }
  assert.match(parsed._closedai_truncated, /Structurally truncated/)
  assert.ok(parsed.items.length < 5_000)
})
