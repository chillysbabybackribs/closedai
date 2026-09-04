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
const typeFile = 'src/shared/api.ts'
const barrelFile = 'src/shared/chat.ts'
const testFile = 'src/main/chat-context/workspace-navigation.test.ts'

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
    const result = await registry.call({ namespace: 'workspace', tool: 'inspect', arguments: args }, { paneId: 'pane', threadId: 't', turnId: 'u', callId: 'r' })
    assert.equal('sourceReads' in result, false, 'internal observations must not reach the provider result')
    const text = result.content.map((item) => item.type === 'text' ? item.text : '').join('\n')
    return { text, error: result.isError }
  }
  return { root, write, call, reads: registry.sourceReads }
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

test('a symbol read includes renamed local types and only tests using that imported symbol', async (t) => {
  const f = await fixture(t)
  await f.write(typeFile, 'export interface Input { value: string }\nexport type Unused = boolean\n')
  await f.write(otherSource, 'import type { Input as Job } from "../../shared/api.js"\ntype Local = { ok: boolean }\nexport function run(input: Job): Local { return { ok: !!input.value } }\n')
  await f.write(testFile, [
    'import test from "node:test"',
    'import { run as execute } from "./workspace-navigation.js"',
    'test("accepts a value", () => { execute({ value: "hello" }) })',
    'test("execute is only in this title", () => { /* execute() */ const value = "execute" })'
  ].join('\n'))
  for (const request of [{ action: 'read', path: otherSource, symbol: 'run' }, { action: 'find', query: 'run', kind: 'symbol' }]) {
    const result = await f.call(request)
    assert.equal(result.error, undefined)
    assert.match(result.text, /Referenced local type: Job/)
    assert.match(result.text, /export interface Input/)
    assert.match(result.text, /Referenced local type: Local/)
    assert.match(result.text, /type Local =/)
    assert.match(result.text, /Test candidate: accepts a value/)
    assert.match(result.text, /execute\(\{ value: "hello" \}\)/)
    assert.doesNotMatch(result.text, /test\("execute is only/)
    assert.doesNotMatch(result.text, /export type Unused/)
  }
})

test('known_hash refreshes changed type and test dependencies while omitting unchanged primary source', async (t) => {
  const f = await fixture(t)
  await f.write(typeFile, 'export type Input = { first: string }\n')
  await f.write(otherSource, 'import type { Input } from "../../shared/api.js"\nexport function run(input: Input) { return input }\n')
  await f.write(testFile, 'import test from "node:test"\nimport { run } from "./workspace-navigation.js"\ntest("first", () => run({ first: "x" }))\n')
  const hash = (await factsFor(f.root, otherSource))!.hash
  await f.call({ action: 'read', path: otherSource, symbol: 'run' })
  await f.write(typeFile, 'export type Input = { second: number }\n')
  await f.write(testFile, 'import test from "node:test"\nimport { run } from "./workspace-navigation.js"\ntest("second", () => run({ second: 2 }))\n')
  const result = await f.call({ action: 'read', path: otherSource, symbol: 'run', known_hash: hash })
  assert.match(result.text, /Unchanged at read time/)
  assert.match(result.text, /second: number/)
  assert.match(result.text, /Test candidate: second/)
  assert.doesNotMatch(result.text, /2: export function run/)
})

test('type resolution follows named reexports and namespace imports without looping or guessing packages', async (t) => {
  const f = await fixture(t)
  await f.write(typeFile, 'export interface Input { value: string }\n')
  await f.write(barrelFile, 'export { Input as Public } from "./api.js"\n')
  await f.write(otherSource, 'import type * as Types from "../../shared/chat.js"\nexport function run(input: Types.Public) { return input }\n')
  assert.match((await f.call({ action: 'read', path: otherSource, symbol: 'run' })).text, /export interface Input/)
  await f.write(typeFile, 'export { Public as Input } from "./chat.js"\n')
  const cycle = await f.call({ action: 'read', path: otherSource, symbol: 'run' })
  assert.equal(cycle.error, undefined)
  assert.doesNotMatch(cycle.text, /Referenced local type:/)
  await f.write(typeFile, 'export type Public = string\n')
  await f.write(otherSource, 'import type { Public } from "some-package"\nexport function run(input: Public) { return input }\n')
  assert.doesNotMatch((await f.call({ action: 'read', path: otherSource, symbol: 'run' })).text, /Referenced local type:/)
})

test('enrichment remains bounded and related opt-out avoids type and test bodies', async (t) => {
  const f = await fixture(t)
  await f.write(typeFile, 'export interface Input {\n' + Array.from({ length: 100 }, (_, i) => `field${i}: string`).join('\n') + '\n}\n')
  await f.write(otherSource, 'import type { Input } from "../../shared/api.js"\nexport function run(input: Input) { return input }\n')
  await f.write(testFile, 'import test from "node:test"\nimport { run } from "./workspace-navigation.js"\n' +
    Array.from({ length: 6 }, (_, i) => `test("case ${i}", () => run({ field0: "x" }))`).join('\n'))
  const result = await f.call({ action: 'read', path: otherSource, symbol: 'run', max_chars: 4000 })
  assert.ok(result.text.length <= 4000)
  assert.match(result.text, /Test candidate: case 0/)
  assert.match(result.text, /additional test candidates omitted/)
  assert.match(result.text, /omitted by budget/)
  const plain = await f.call({ action: 'read', path: otherSource, symbol: 'run', include_related: false })
  assert.doesNotMatch(plain.text, /Referenced local type:|Test candidate:/)
})

test('tests using static members of named and namespace imports are relevant to their class', async (t) => {
  const f = await fixture(t)
  await f.write(otherSource, 'export class Runner { static run() { return 1 } }\n')
  await f.write(testFile, 'import test from "node:test"\nimport { Runner as Job } from "./workspace-navigation.js"\n' +
    'import * as source from "./workspace-navigation.js"\ntest("named member", () => Job.run())\ntest("namespace member", () => source.Runner.run())\n')
  const result = await f.call({ action: 'read', path: otherSource, symbol: 'Runner' })
  assert.match(result.text, /Test candidate: named member/)
  assert.match(result.text, /Test candidate: namespace member/)
})

test('source results record emitted file versions for follow-up context, not every scanned file', async (t) => {
  const f = await fixture(t)
  await f.call({ action: 'find', query: 'Widget', include_source: false })
  const scope = { paneId: 'pane', threadId: 't', cwd: f.root }
  assert.equal(await f.reads.changes(scope), null)
  await f.call({ action: 'read', path: component, symbol: 'Widget' })
  await f.write(component, 'export function Widget() { return null }\n')
  await f.write(stylesheet, '.widget { color: green; }\n')
  const report = (await f.reads.changes(scope))!
  assert.deepEqual(report.changes.map((entry) => entry.path).sort(), [component, stylesheet].sort())
  assert.equal(await f.reads.changes({ ...scope, threadId: 'other' }), null)
})
