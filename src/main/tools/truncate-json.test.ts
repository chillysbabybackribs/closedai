import assert from 'node:assert/strict'
import test from 'node:test'
import { truncateJsonText, truncateText, TRUNCATION_NOTE_KEY } from './truncate-json.js'

const ADVICE = 'Narrow it.'

test('short text passes through untouched', () => {
  assert.deepEqual(truncateText('hello', 100, ADVICE), { text: 'hello', truncated: false })
  assert.equal(truncateJsonText('{"a":1}', 100, ADVICE), null)
})

test('plain text is cut with a footer that states the dropped size', () => {
  const out = truncateText('x'.repeat(1_500), 1_000, ADVICE)
  assert.equal(out.truncated, true)
  assert.ok(out.text.startsWith('x'.repeat(1_000)))
  assert.match(out.text, /\[ClosedAI truncated 500 characters\. Narrow it\.\]/)
})

test('a JSON object shrinks structurally and stays parseable', () => {
  const value = {
    title: 'a'.repeat(6_000),
    elements: Array.from({ length: 500 }, (_, i) => ({ ref: `e${i}`, name: 'b'.repeat(50) }))
  }
  const text = JSON.stringify(value, null, 2)
  const out = truncateText(text, 8_000, ADVICE)
  assert.equal(out.truncated, true)
  assert.ok(out.text.length <= 8_000)
  const parsed = JSON.parse(out.text) as Record<string, unknown>
  assert.match(String(parsed[TRUNCATION_NOTE_KEY]), /Structurally truncated from \d+ characters.*Narrow it\./)
  assert.ok(String(parsed.title).endsWith('chars]'))
  const elements = parsed.elements as unknown[]
  assert.ok(elements.length < 500)
  assert.match(String(elements.at(-1)), /more items\]/)
  assert.deepEqual(elements[0], { ref: 'e0', name: 'b'.repeat(50) })
})

test('a JSON array keeps its shape and appends the note as a final element', () => {
  const text = JSON.stringify(Array.from({ length: 2_000 }, (_, i) => ({ i, text: 'c'.repeat(30) })))
  const out = truncateText(text, 3_000, ADVICE)
  const parsed = JSON.parse(out.text) as unknown[]
  assert.ok(out.text.length <= 3_000)
  assert.match(String(parsed.at(-1)), new RegExp(`\\[${TRUNCATION_NOTE_KEY}\\]`))
  assert.deepEqual(parsed[0], { i: 0, text: 'c'.repeat(30) })
})

test('deep nesting collapses to placeholders before giving up', () => {
  let value: unknown = 'leaf'
  for (let depth = 0; depth < 200; depth += 1) value = { child: value, pad: 'p'.repeat(20) }
  const out = truncateText(JSON.stringify(value), 1_500, ADVICE)
  assert.ok(out.text.length <= 1_500)
  assert.doesNotThrow(() => JSON.parse(out.text))
})

test('text that merely starts with a brace but is not JSON falls back to a plain cut', () => {
  const out = truncateText(`{not json ${'y'.repeat(2_000)}`, 500, ADVICE)
  assert.ok(out.text.startsWith('{not json'))
  assert.match(out.text, /ClosedAI truncated/)
})
