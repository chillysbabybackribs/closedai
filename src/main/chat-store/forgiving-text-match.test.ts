import assert from 'node:assert/strict'
import test from 'node:test'
import { matchLabel, matchText, prepareTextQuery } from './forgiving-text-match.js'

function match(query: string, text: string, fuzzy = true) {
  return matchText(prepareTextQuery(query)!, text, { fuzzy })
}

test('exact phrase wins and collapses whitespace runs', () => {
  assert.deepEqual(match('Spine v1', 'implement spine v1 now'), { kind: 'exact', start: 10, end: 18, quality: 1 })
  const spaced = match('spine v1', 'implement spine\n\n  v1 now')
  assert.equal(spaced?.kind, 'exact')
  assert.equal('implement spine\n\n  v1 now'.slice(spaced!.start, spaced!.end), 'spine\n\n  v1')
})

test('spacing tier ignores spaces, punctuation, case, and accents', () => {
  const text = 'we shipped Spine-V1 after the café review'
  const hit = match('spinev1', text)
  assert.equal(hit?.kind, 'spacing')
  assert.equal(text.slice(hit!.start, hit!.end), 'Spine-V1')
  assert.equal(match('spine v 1', 'the spinev1 chat')?.kind, 'spacing')
  assert.equal(match('cafe review', text)?.kind, 'spacing')
  assert.equal(match('chat_memory_index', 'chatMemoryIndex')?.kind, 'spacing')
})

test('fuzzy tier tolerates small typos across spacing', () => {
  assert.equal(match('spnie v1', 'implement spine v1')?.kind, 'fuzzy')
  assert.equal(match('rotaton lookup', 'fix the rotated lookup')?.kind, 'fuzzy')
  assert.equal(match('memroy index verification', 'Post-restart chat memory index verification')?.kind, 'fuzzy')
})

test('fuzzy tier matches every word anywhere, with per-word typo budgets', () => {
  const hit = match('vermont octobr trip', 'October trip planning for Vermont')
  assert.equal(hit?.kind, 'fuzzy')
  assert.equal(match('vermont octobr trip', 'Vermont in July'), null)
})

test('fuzzy is opt-out and short queries never match loosely', () => {
  assert.equal(match('spnie v1', 'implement spine v1', false), null)
  assert.equal(match('cat', 'the car is red'), null)
  assert.equal(match('abcd', 'abce'), null)
})

test('exact match beats fuzzy quality and labels report non-literal hits', () => {
  const text = 'we shipped spine v1'
  assert.deepEqual(matchLabel(match('spine v1', text)!, text), {})
  assert.deepEqual(matchLabel(match('spinev1', text)!, text), { match: 'spacing', matched: 'spine v1' })
  const fuzzy = match('spien v1', text)!
  assert.equal(matchLabel(fuzzy, text).match, 'fuzzy')
  assert.ok(fuzzy.quality < 0.9)
})
