import assert from 'node:assert/strict'
import test from 'node:test'
import { WORKSPACE_INDEX_ROOT } from './workspace-index.generated.ts'
import { ToolRegistry } from '../registry.ts'
import { workspaceTools } from './index.ts'

function harness() {
  const namespace = workspaceTools(WORKSPACE_INDEX_ROOT)
  assert.ok(namespace)
  const registry = new ToolRegistry([namespace])
  const call = (arguments_: Record<string, unknown>) => registry.call(
    { namespace: 'closedai_workspace', tool: 'inspect', arguments: arguments_ },
    { threadId: null, turnId: null, callId: 'workspace-test' }
  )
  return { call, registry }
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.type === 'text' ? result.content[0].text ?? '' : ''
}

test('workspace tools are advertised only for the indexed checkout', () => {
  assert.equal(workspaceTools('/some/other/checkout'), null)
  const { registry } = harness()
  assert.deepEqual(registry.names(), ['closedai_workspace.inspect'])
  assert.equal(registry.namespaces[0].tools[0].deferLoading, undefined)
  assert.deepEqual(
    registry.namespaces[0].tools[0].actions?.map((action) => action.name),
    ['find', 'outline', 'map', 'related', 'tests', 'ipc_flow', 'read']
  )
})

test('map returns a bounded scope, omits tests, and labels only sibling tests', async () => {
  const { call } = harness()
  const result = await call({ action: 'map', path: 'src/main/chat-context', depth: 0 })
  const text = textOf(result)
  assert.equal(result.isError, undefined)
  assert.match(text, /workspace-navigation\.ts \[sibling test\]/)
  assert.doesNotMatch(text, /workspace-navigation\.test\.ts/)
  assert.doesNotMatch(text, /coverage/i)
})

test('related reports direct imports and importers without package dependencies', async () => {
  const { call } = harness()
  const result = await call({ action: 'related', path: 'src/main/chat-context/thread-params.ts' })
  const text = textOf(result)
  assert.equal(result.isError, undefined)
  assert.match(text, /src\/main\/chat-context\/workspace-navigation\.ts/)
  assert.match(text, /src\/main\/chat-context\/workspace-navigation\.test\.ts/)
  assert.doesNotMatch(text, /node:path/)
})

test('tests reports candidates and explicitly disclaims coverage', async () => {
  const { call } = harness()
  const result = await call({ action: 'tests', path: 'src/main/chat-context/workspace-navigation.ts' })
  const text = textOf(result)
  assert.equal(result.isError, undefined)
  assert.match(text, /workspace-navigation\.test\.ts/)
  assert.match(text, /does not measure test execution or coverage/)
})

test('ipc_flow can list or filter generated ownership', async () => {
  const { call } = harness()
  const filtered = await call({ action: 'ipc_flow', namespace: 'chat:*' })
  assert.equal(textOf(filtered), 'Preload IPC ownership\n\nchat:* -> src/main/chat-ipc.ts')
  const all = await call({ action: 'ipc_flow' })
  assert.match(textOf(all), /browserDownloads:\* -> src\/main\/browser-downloads-ipc\.ts/)
})

test('paths cannot escape the indexed workspace', async () => {
  const { call } = harness()
  const result = await call({ action: 'map', path: '../outside' })
  assert.equal(result.isError, true)
  assert.match(textOf(result), /must stay inside/)
})

test('find ranks the component that renders a label above prose that mentions it', async () => {
  const { call } = harness()
  const result = await call({ action: 'find', query: 'Turn trace' })
  const text = textOf(result)
  assert.equal(result.isError, undefined)
  const component = text.indexOf('src/renderer/project-menu.tsx')
  const prose = text.indexOf('docs/')
  assert.ok(component >= 0, 'the rendering component is missing from the results')
  assert.ok(prose === -1 || component < prose, 'prose outranked the component that renders the label')
})

test('find resolves a class to its rules, including a multi-line selector', async () => {
  const { call } = harness()
  const text = textOf(await call({ action: 'find', query: 'composer-strip-action', kind: 'style' }))
  // The rule is written as ".composer-project-trigger,\n.composer-strip-action {".
  assert.match(text, /style \(\d+\):/)
  assert.match(text, /src\/renderer\/styles\/prompt-kit-chat\.css:\d+ +\.composer-strip-action/)
  assert.doesNotMatch(text, /^text \(/m)
})

test('find locates an exported symbol at its declaration', async () => {
  const { call } = harness()
  const text = textOf(await call({ action: 'find', query: 'workspaceNavigationSection', kind: 'symbol' }))
  assert.match(text, /src\/main\/chat-context\/workspace-navigation\.ts:\d+ +function workspaceNavigationSection/)
})

test('find reports no match with a usable next step instead of failing', async () => {
  const { call } = harness()
  const result = await call({ action: 'find', query: 'zzzz-not-in-this-repository' })
  assert.equal(result.isError, undefined)
  assert.match(textOf(result), /\(no match\)/)
})

test('outline summarises a component and pairs its classes with the defining stylesheet', async () => {
  const { call } = harness()
  const result = await call({ action: 'outline', path: 'src/renderer/project-menu.tsx' })
  const text = textOf(result)
  assert.equal(result.isError, undefined)
  assert.match(text, /Exported symbols \(line span\)/)
  assert.match(text, /\n  \d+-\d+: function ProjectMenu/)
  assert.match(text, /composer\.trace/)
  assert.match(text, /\.composer-strip-action -> src\/renderer\/styles\/prompt-kit-chat\.css:\d+/)
})

test('outline rejects a path outside the index', async () => {
  const { call } = harness()
  const result = await call({ action: 'outline', path: 'src/renderer/does-not-exist.tsx' })
  assert.equal(result.isError, true)
  assert.match(textOf(result), /is not an indexed file/)
})
