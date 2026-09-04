import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { defineActionTool } from '../action-tool.js'
import { readFileSnapshot } from '../file-snapshot.js'
import { ToolRegistry } from '../registry.js'
import { findAction } from './find.js'
import { outlineAction } from './outline.js'
import { readAction } from './read.js'
import { factsFor } from './scan.js'

const component = 'src/renderer/project-menu.tsx'
const stylesheet = 'src/renderer/styles/prompt-kit-chat.css'
const otherStyle = 'src/renderer/styles/chat/messages.css'
const otherSource = 'src/main/chat-context/workspace-navigation.ts'

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'closedai-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const write = async (file: string, source: string) => {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), source)
  }
  await write(component, 'export function Widget() {\n  return <div className="widget" />\n}\n')
  await write(stylesheet, '.widget { color: red; }\n@media (max-width: 600px) {\n  .widget:hover { color: blue; content: "}"; }\n}\n')
  await write(otherStyle, '.widget { padding: 4px; }\n')
  const registry = new ToolRegistry([{ name: 'workspace', description: 'test', tools: [defineActionTool({
    name: 'inspect', description: 'test', actions: [findAction(root), outlineAction(root), readAction(root)]
  })] }])
  const call = async (args: Record<string, unknown>) => {
    const result = await registry.call({ namespace: 'workspace', tool: 'inspect', arguments: args }, { threadId: 't', turnId: 'u', callId: 'r' })
    const text = result.content.map((item) => item.type === 'text' ? item.text : '').join('\n')
    return { text, error: result.isError }
  }
  return { root, write, call }
}

test('exact symbol lookup includes implementation, all style owners, conditions and test paths', async (t) => {
  const f = await fixture(t)
  const result = await f.call({ action: 'find', query: 'Widget', kind: 'symbol' })
  assert.equal(result.error, undefined)
  assert.match(result.text, /1: export function Widget\(\)/)
  assert.match(result.text, /sha256:[a-f0-9]{64}/)
  assert.match(result.text, /color: red/)
  assert.match(result.text, /color: blue/)
  assert.match(result.text, /Conditions: @media \(max-width: 600px\)/)
  assert.match(result.text, /padding: 4px/)
  assert.match(result.text, /Sibling test candidates/)
  assert.ok(result.text.length < 24_000)
})

test('ambiguous symbols and source opt-out do not add guessed implementation', async (t) => {
  const f = await fixture(t)
  assert.doesNotMatch((await f.call({ action: 'find', query: 'Widget', include_source: false })).text, /Source:/)
  await f.write(otherSource, 'export function Widget() { return 2 }\n')
  assert.doesNotMatch((await f.call({ action: 'find', query: 'Widget' })).text, /Source:/)
})

test('a matching hash omits only primary source; changed related files still return fresh rules', async (t) => {
  const f = await fixture(t)
  const hash = (await factsFor(f.root, component))!.hash
  await f.write(stylesheet, '.widget { color: green; }\n')
  const result = await f.call({ action: 'read', path: component, symbol: 'Widget', known_hash: hash })
  assert.match(result.text, /Unchanged at read time/)
  assert.doesNotMatch(result.text, /1: export function/)
  assert.match(result.text, /color: green/)
  await f.write(component, 'export function Widget() { return "changed" }\n')
  const changed = await f.call({ action: 'read', path: component, symbol: 'Widget', known_hash: hash })
  assert.match(changed.text, /1: export function Widget\(\) \{ return "changed"/)
  assert.doesNotMatch(changed.text, /Unchanged at read time/)
})

test('budgeted reads label exactly the complete returned lines and explicitly omit the rest', async (t) => {
  const f = await fixture(t)
  await f.write(component, Array.from({ length: 100 }, (_, index) => 'const row' + index + ' = "' + 'x'.repeat(100) + '"').join('\n'))
  const result = await f.call({ action: 'read', path: component, start_line: 1, end_line: 100, max_chars: 1000, include_related: false })
  assert.ok(result.text.length <= 1000)
  assert.match(result.text, /omitted by budget/)
  const end = Number(/Returned lines 1-(\d+)/.exec(result.text)![1])
  const numbered = result.text.split('\n').filter((line) => /^\d+: /.test(line))
  assert.equal(numbered.length, end)
  assert.ok(numbered.every((line) => line.endsWith('"')))
  await f.write(component, 'x'.repeat(2000))
  const hugeLine = await f.call({ action: 'read', path: component, max_chars: 1000, include_related: false })
  assert.doesNotMatch(hugeLine.text, /Returned lines/)
  assert.match(hugeLine.text, /omitted/)
})

test('hashes follow source bytes despite preserved timestamps, and caches are scoped by root', async (t) => {
  const a = await fixture(t)
  const b = await fixture(t)
  const path = join(a.root, component)
  const initial = (await factsFor(a.root, component))!
  const info = await stat(path)
  await a.write(component, 'export const Changed = 1\n')
  await utimes(path, info.atime, info.mtime)
  const updated = (await factsFor(a.root, component))!
  assert.notEqual(initial.hash, updated.hash)
  assert.equal(updated.exports[0]!.name, 'Changed')
  const independent = (await factsFor(b.root, component))!
  assert.equal(independent.exports[0]!.name, 'Widget')
  assert.notEqual(independent.path, updated.path)
  const bytes = await readFile(path)
  assert.equal(updated.hash, 'sha256:' + createHash('sha256').update(bytes).digest('hex'))
  assert.equal(updated.source, bytes.toString('utf8'))
})

test('outline names every repeated style owner but establishes no source coverage', async (t) => {
  const f = await fixture(t)
  const result = await f.call({ action: 'outline', path: component })
  assert.match(result.text, /outline only; no source coverage/)
  assert.match(result.text, /prompt-kit-chat\.css:1-1/)
  assert.match(result.text, /prompt-kit-chat\.css:3-3/)
  assert.match(result.text, /chat\/messages\.css:1-1/)
})

test('source selection rejects invalid ranges and ambiguous symbols', async (t) => {
  const f = await fixture(t)
  for (const fields of [{ start_line: 100 }, { start_line: 3, end_line: 1 }, { symbol: 'Missing' }, { symbol: 'Widget', start_line: 1 }]) {
    assert.equal((await f.call({ action: 'read', path: component, ...fields })).error, true)
  }
})

test('snapshots reject binary and oversized files', async (t) => {
  const f = await fixture(t)
  await writeFile(join(f.root, component), Buffer.from([0xff, 0xfe]))
  await assert.rejects(readFileSnapshot(join(f.root, component)), /UTF-8/)
  await f.write(component, 'x'.repeat(2_000_001))
  await assert.rejects(readFileSnapshot(join(f.root, component)), /2 MB/)
})
