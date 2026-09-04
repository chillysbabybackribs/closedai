import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeSource } from './source-analysis.js'

test('declaration spans come from syntax rather than column-zero comments or string contents', () => {
  const source = [
    'export function real() {',
    '// This comment must not end the declaration.',
    '  return `export function pretend() {}`',
    '}',
    'export const next = 1'
  ].join('\n')
  const result = analyzeSource('source.ts', source)
  assert.deepEqual(result.exports.map(({ name, line, end }) => ({ name, line, end })), [
    { name: 'real', line: 1, end: 4 }, { name: 'next', line: 5, end: 5 }
  ])
})

test('type references preserve namespace and alias bindings but exclude generic and nested shadows', () => {
  const result = analyzeSource('source.ts', [
    'import type { Input as Job, T } from "./types.js"',
    'import type * as Model from "./types.js"',
    'type Local = { value: string }',
    'export function work<T>(arg: Job, model: Model.Input, generic: T): Local {',
    '  type Job = number',
    '  const nested: Job = 1',
    '  return { value: "T Job Model.Fake" }',
    '}'
  ].join('\n'))
  assert.deepEqual(result.imports.map(({ local, imported }) => ({ local, imported })), [
    { local: 'Job', imported: 'Input' }, { local: 'T', imported: 'T' }, { local: 'Model', imported: '*' }
  ])
  assert.ok(result.typeRefs.some((ref) => ref.name === 'Job' && ref.line === 4))
  assert.ok(result.typeRefs.some((ref) => ref.name === 'Model.Input'))
  assert.ok(result.typeRefs.some((ref) => ref.name === 'Local'))
  assert.ok(!result.typeRefs.some((ref) => ref.name === 'T' || ref.line === 6))
})

test('test extraction follows imported aliases and ignores titles, comments and callback shadows', () => {
  const result = analyzeSource('source.test.ts', [
    'import { test as check } from "node:test"',
    'import { run as execute } from "./source.js"',
    'import * as source from "./source.js"',
    'check("actual call", () => { execute() })',
    'check.skip("namespace call", () => { source.run() })',
    'check("execute in name only", () => { /* execute() */ const text = "execute" })',
    'check("shadowed", (execute) => { execute() })'
  ].join('\n'))
  assert.equal(result.tests.length, 4)
  assert.deepEqual(result.tests[0]!.references, ['execute'])
  assert.deepEqual(result.tests[1]!.references, ['source.run'])
  assert.deepEqual(result.tests[2]!.references, [])
  assert.deepEqual(result.tests[3]!.references, [])
})

test('export aliases and default type declarations retain their local binding', () => {
  const result = analyzeSource('source.ts', [
    'export { Input as PublicInput } from "./types.js"',
    'export default interface Settings { value: string }',
    'type Private = number',
    'export { Private as Public }'
  ].join('\n'))
  assert.equal(result.exports.find((entry) => entry.name === 'PublicInput')?.from, './types.js')
  assert.equal(result.exports.find((entry) => entry.name === 'default')?.localName, 'Settings')
  assert.equal(result.exports.find((entry) => entry.name === 'Public')?.localName, 'Private')
  assert.deepEqual(result.types.map((entry) => entry.name), ['Settings', 'Private'])
})
