import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMcpToolName, resultImageUrl, resultText, toolResultItem, toolUseItem } from './claude-tool-items.js'

const noScreenshot = (): null => null

test('Bash becomes a command item whose result fills output and exit state', () => {
  const started = toolUseItem({ id: 't1', name: 'Bash', input: { command: 'npm test', description: 'Run tests' } }, 'turn', '/w')
  assert.deepEqual(started, { type: 'command', id: 't1', turnId: 'turn', command: 'npm test', cwd: '/w', status: 'inProgress', output: '', exitCode: null })
  const done = toolResultItem(started, { content: 'ok\n3 passing', isError: false }, noScreenshot)
  assert.equal(done.type, 'command')
  if (done.type !== 'command') return
  assert.equal(done.status, 'completed')
  assert.equal(done.output, 'ok\n3 passing')
  assert.equal(done.exitCode, 0)
  const failed = toolResultItem(started, { content: [{ type: 'text', text: 'boom\nExit code 2' }], isError: true }, noScreenshot)
  if (failed.type !== 'command') return
  assert.equal(failed.status, 'failed')
  assert.equal(failed.exitCode, 2)
})

test('edits become file changes with a readable diff', () => {
  const edit = toolUseItem({ id: 'e', name: 'Edit', input: { file_path: '/w/a.ts', old_string: 'a\nb', new_string: 'c' } }, null, '/w')
  assert.equal(edit.type, 'fileChange')
  if (edit.type !== 'fileChange') return
  assert.deepEqual(edit.changes, [{ path: '/w/a.ts', kind: 'update', diff: '-a\n-b\n+c' }])
  const write = toolUseItem({ id: 'w', name: 'Write', input: { file_path: '/w/new.ts', content: 'x\ny' } }, null, '/w')
  if (write.type !== 'fileChange') return
  assert.deepEqual(write.changes, [{ path: '/w/new.ts', kind: 'add', diff: '+x\n+y' }])
  const multi = toolUseItem({ id: 'm', name: 'MultiEdit', input: { file_path: '/w/m.ts', edits: [{ old_string: '1', new_string: '2' }, { old_string: '3', new_string: '4' }] } }, null, '/w')
  if (multi.type !== 'fileChange') return
  assert.equal(multi.changes[0]!.diff, '-1\n+2\n@@\n-3\n+4')
  const settled = toolResultItem(multi, { content: 'The file has been updated', isError: false }, noScreenshot)
  assert.equal(settled.type === 'fileChange' && settled.status, 'completed')
})

test('plan tools become plan items; built-ins get readable labels', () => {
  const todo = toolUseItem({ id: 'p', name: 'TodoWrite', input: { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }, { content: 'c', status: 'pending' }] } }, null, '/w')
  assert.equal(todo.type === 'plan' && todo.text, '- [x] a\n- [~] b\n- [ ] c')
  const read = toolUseItem({ id: 'r', name: 'Read', input: { file_path: '/w/x.ts' } }, null, '/w')
  assert.deepEqual(read, { type: 'tool', id: 'r', turnId: null, label: 'Read file', detail: '/w/x.ts', status: 'inProgress' })
  const search = toolUseItem({ id: 's', name: 'WebSearch', input: { query: 'electron 44' } }, null, '/w')
  assert.equal(search.type === 'tool' && search.label, 'Web search')
  const unknown = toolUseItem({ id: 'u', name: 'ListAgents', input: { q: 1 } }, null, '/w')
  assert.equal(unknown.type === 'tool' && unknown.label, 'ListAgents')
  assert.equal(unknown.type === 'tool' && unknown.detail, '{\n  "q": 1\n}')
})

test('ClosedAI tools arrive namespaced and keep the Codex MCP label shape', () => {
  assert.deepEqual(parseMcpToolName('mcp__embedded_browser__page'), { namespace: 'embedded_browser', tool: 'page' })
  assert.equal(parseMcpToolName('Bash'), null)
  const item = toolUseItem({ id: 'b', name: 'mcp__embedded_browser__page', input: { action: 'navigate', url: 'https://x' } }, 'turn', '/w')
  assert.equal(item.type === 'tool' && item.label, 'embedded_browser · page')
  const failed = toolResultItem(item, { content: [{ type: 'text', text: '{"ok":false}' }], isError: true }, noScreenshot)
  assert.equal(failed.type === 'tool' && failed.status, 'failed')
})

test('a capture result becomes a screenshot item, preferring the full-resolution store copy', () => {
  const item = toolUseItem({ id: 'c1', name: 'mcp__closedai_ui__capture', input: { action: 'browser_page' } }, 'turn', '/w')
  const content = [
    { type: 'text', text: 'Captured the page\nCapture ID: c1' },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }
  ]
  const scaled = toolResultItem(item, { content, isError: false }, noScreenshot)
  assert.deepEqual(scaled, { type: 'screenshot', id: 'c1', turnId: 'turn', imageUrl: 'data:image/jpeg;base64,AAAA', surface: 'browser_page', caption: 'Captured the page' })
  const full = toolResultItem(item, { content, isError: false }, (id) => (id === 'c1' ? { dataUrl: 'data:image/png;base64,FULL' } : null))
  assert.equal(full.type === 'screenshot' && full.imageUrl, 'data:image/png;base64,FULL')
  const errored = toolResultItem(item, { content: 'Screenshot budget reached', isError: true }, noScreenshot)
  assert.equal(errored.type, 'tool')
})

test('result text and images are read from either wire shape', () => {
  assert.equal(resultText('plain'), 'plain')
  assert.equal(resultText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }]), 'a\nb')
  assert.equal(resultImageUrl('plain'), null)
  assert.equal(resultImageUrl([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'Q' } }]), 'data:image/png;base64,Q')
})
