import assert from 'node:assert/strict'
import test from 'node:test'
import { dynamicToolSpecs } from './app-server-tools.js'
import { toolManifest } from './manifest.js'
import { defineActionTool } from './action-tool.js'
import { boundResult, MAX_RESULT_TEXT_CHARS, ToolRegistry } from './registry.js'
import { textResult, type ToolNamespace } from './tool.js'
import type { SourceReadScope, SourceVersion } from './source-read-history.js'

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

test('successful source observations are scoped and stripped, while failed calls establish none', async () => {
  let fail = false
  const read = { cwd: '/workspace', path: '/workspace/file.ts', hash: 'sha256:' + 'a'.repeat(64) }
  const registry = new ToolRegistry([{ name: 'source', description: 'test', tools: [{
    name: 'read', description: 'test', inputSchema: { type: 'object', properties: {} },
    run: async () => ({ ...textResult('source text'), sourceReads: [read], ...(fail ? { isError: true } : {}) })
  }] }])
  const seen: Array<{ scope: SourceReadScope; read: SourceVersion }> = []
  registry.sourceReads.remember = (scope, read) => { seen.push({ scope, read }) }
  const caller = { ...context, paneId: 'pane', threadId: 'thread' }
  const request = { namespace: 'source', tool: 'read', arguments: {} }
  const result = await registry.call(request, caller)
  assert.deepEqual(result, textResult('source text'))
  assert.deepEqual(seen, [{ scope: { paneId: 'pane', threadId: 'thread', cwd: '/workspace' }, read }])
  fail = true
  assert.equal((await registry.call(request, caller)).isError, true)
  assert.equal(seen.length, 1)
})

test('a wrong name is answered with the tools that exist, and counted as misuse not a failure', async () => {
  const registry = new ToolRegistry(namespaces())
  const records: Array<{ toolId: string; ok: boolean; misuse: boolean }> = []
  registry.subscribe((record) => records.push({ toolId: record.toolId, ok: record.ok, misuse: record.misuse }))

  const foreign = await registry.call({ namespace: null, tool: 'Grep', arguments: {} }, context)
  assert.equal(foreign.isError, true)
  const foreignText = foreign.content[0].type === 'text' ? foreign.content[0].text : ''
  assert.match(foreignText, /Unknown tool: Grep\. This app's tools are: alpha\.one, alpha\.two, beta\.three\./)
  assert.match(foreignText, /your own harness provides .* call those directly/)

  const sibling = await registry.call({ namespace: 'alpha', tool: 'nope', arguments: {} }, context)
  const siblingText = sibling.content[0].type === 'text' ? sibling.content[0].text : ''
  assert.match(siblingText, /Unknown tool: alpha\.nope\. alpha has: one, two\./)

  const ran = await registry.call({ namespace: 'alpha', tool: 'one', arguments: {} }, context)
  assert.equal(ran.isError, undefined)
  assert.deepEqual(records, [
    { toolId: 'Grep', ok: false, misuse: true },
    { toolId: 'alpha.nope', ok: false, misuse: true },
    { toolId: 'alpha.one', ok: true, misuse: false }
  ])
})

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
  assert.ok(first.startsWith('x'.repeat(100)))
  assert.match(first, /\[ClosedAI truncated this result.*Narrow the request/)
  assert.ok(first.length + 5 <= MAX_RESULT_TEXT_CHARS)
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

test('multi-block results share one budget while retaining JSON, images and trailing errors', () => {
  const image = { type: 'image' as const, dataUrl: 'data:image/png;base64,AA==' }
  const result = boundResult({ isError: true, content: [
    { type: 'text', text: JSON.stringify({ rows: Array.from({ length: 1000 }, () => 'x'.repeat(50)) }) },
    image,
    { type: 'text', text: 'y'.repeat(20_000) },
    { type: 'text', text: 'Final error: retry a smaller range.' }
  ] })
  const texts = result.content.filter((item) => item.type === 'text')
  assert.ok(texts.reduce((total, item) => total + item.text.length, 0) <= MAX_RESULT_TEXT_CHARS)
  assert.doesNotThrow(() => JSON.parse(texts[0]!.text))
  assert.equal(result.content[1], image)
  assert.equal(texts.at(-1)?.text, 'Final error: retry a smaller range.')
  assert.equal(result.isError, true)
})

test('many small blocks cannot bypass the aggregate budget', () => {
  const result = boundResult({ content: Array.from({ length: 1000 }, () => ({ type: 'text' as const, text: 'a'.repeat(100) })) })
  const texts = result.content.filter((item) => item.type === 'text')
  assert.ok(texts.reduce((sum, item) => sum + item.text.length, 0) <= MAX_RESULT_TEXT_CHARS)
  assert.match(texts.at(-1)!.text, /omitted.*text blocks/)
})

test('thrown tool errors obey the same context budget', async () => {
  const registry = new ToolRegistry([{ name: 'errors', description: 'errors', tools: [{
    name: 'fail', description: 'fail', inputSchema: { type: 'object', properties: {} },
    run: async () => { throw new Error('large error '.repeat(5000)) }
  }] }])
  const result = await registry.call({ namespace: 'errors', tool: 'fail', arguments: {} }, context)
  assert.equal(result.isError, true)
  assert.ok(result.content[0]?.type === 'text')
  assert.ok(result.content[0].text.length <= MAX_RESULT_TEXT_CHARS)
})
