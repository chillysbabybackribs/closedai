import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { evaluateInPage, parseEvaluation, queryScript } from './browser-page-evaluate.js'
import type { ScriptRunner } from './browser-page-ready.js'

// Runs the page script in a bare VM context: no DOM, which is enough to prove the wrapper,
// the serialiser, the bound, and the error path. The query script is checked for shape only.
function runner(globals: Record<string, unknown> = {}): ScriptRunner {
  const context = vm.createContext({ ...globals })
  return {
    isDestroyed: () => false,
    executeJavaScript: async (code: string) => vm.runInContext(code, context)
  }
}

test('evaluate returns expression values, awaits promises, and reports the type', async () => {
  const contents = runner()
  assert.deepEqual(await evaluateInPage(contents, { expression: '1 + 2', maxChars: 1_000 }), { ok: true, type: 'number', value: 3, truncated: false })
  assert.deepEqual(await evaluateInPage(contents, { expression: 'Promise.resolve({ a: [1, "x", null] })', maxChars: 1_000 }), { ok: true, type: 'object', value: { a: [1, 'x', null] }, truncated: false })
  assert.deepEqual(await evaluateInPage(contents, { expression: 'undefined', maxChars: 1_000 }), { ok: true, type: 'undefined', value: null, truncated: false })
})

test('evaluate accepts statements with a return and reports thrown errors', async () => {
  const contents = runner()
  const statements = await evaluateInPage(contents, { expression: 'const a = 2; const b = 3; return a * b', maxChars: 1_000 })
  assert.deepEqual(statements, { ok: true, type: 'number', value: 6, truncated: false })
  const failed = await evaluateInPage(contents, { expression: 'null.missing', maxChars: 1_000 })
  assert.equal(failed.ok, false)
  assert.match(!failed.ok ? failed.error : '', /TypeError/)
})

test('evaluate serialises awkward values and bounds the result', async () => {
  const contents = runner()
  const awkward = await evaluateInPage(contents, {
    expression: 'const o = { f() {}, d: new Date(0), m: new Map([["k", 1]]), big: 10n }; o.self = o; return o',
    maxChars: 1_000
  })
  assert.deepEqual(awkward, {
    ok: true, type: 'object', truncated: false,
    value: { f: '[Function f]', d: '1970-01-01T00:00:00.000Z', m: [['k', 1]], big: '10n', self: '[Circular]' }
  })
  const bounded = await evaluateInPage(contents, { expression: '"x".repeat(5000)', maxChars: 1_000 })
  assert.equal(bounded.ok && bounded.truncated, true)
  assert.equal(bounded.ok && typeof bounded.value === 'string' && bounded.value.length, 1_000)
})

test('parseEvaluation tolerates a page that returns nothing usable', () => {
  assert.deepEqual(parseEvaluation(undefined), { ok: false, error: 'The page returned no result' })
  assert.deepEqual(parseEvaluation('{"ok":false}'), { ok: false, error: 'Evaluation failed' })
})

test('the query script embeds its options safely', () => {
  const script = queryScript({ selector: 'a[href="x"]', text: 'O\'Reilly', attributes: ['data-id'], visibleOnly: true, limit: 3, maxText: 50 })
  assert.match(script, /const selector = "a\[href=\\"x\\"\]"/)
  assert.match(script, /const needle = "o'reilly"/)
  assert.match(script, /const attributes = \["data-id"\]/)
  assert.match(script, /items\.length < 3/)
  assert.doesNotThrow(() => new vm.Script(script))
})
