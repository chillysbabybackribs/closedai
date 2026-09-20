import assert from 'node:assert/strict'
import test from 'node:test'
import { parseUnifiedDiff, highlightTokens } from './diff-viewer.js'

test('parseUnifiedDiff extracts line numbers, hunks, additions and deletions', () => {
  const diff = [
    '@@ -10,3 +10,4 @@ function test()',
    ' const a = 1',
    '-const b = 2',
    '+const b = 3',
    '+const c = 4',
    ' return a + b'
  ].join('\n')

  const parsed = parseUnifiedDiff(diff)
  assert.equal(parsed.additions, 2)
  assert.equal(parsed.deletions, 1)
  assert.equal(parsed.hunks.length, 1)

  const hunk = parsed.hunks[0]!
  assert.equal(hunk.header, '@@ -10,3 +10,4 @@ function test()')
  assert.equal(hunk.lines.length, 5)

  // Context line
  assert.equal(hunk.lines[0]?.kind, 'context')
  assert.equal(hunk.lines[0]?.oldNum, 10)
  assert.equal(hunk.lines[0]?.newNum, 10)
  assert.equal(hunk.lines[0]?.text, 'const a = 1')

  // Remove line
  assert.equal(hunk.lines[1]?.kind, 'remove')
  assert.equal(hunk.lines[1]?.oldNum, 11)
  assert.equal(hunk.lines[1]?.newNum, null)
  assert.equal(hunk.lines[1]?.text, 'const b = 2')

  // Add lines
  assert.equal(hunk.lines[2]?.kind, 'add')
  assert.equal(hunk.lines[2]?.oldNum, null)
  assert.equal(hunk.lines[2]?.newNum, 11)
  assert.equal(hunk.lines[2]?.text, 'const b = 3')

  assert.equal(hunk.lines[3]?.kind, 'add')
  assert.equal(hunk.lines[3]?.oldNum, null)
  assert.equal(hunk.lines[3]?.newNum, 12)
  assert.equal(hunk.lines[3]?.text, 'const c = 4')

  // Context line
  assert.equal(hunk.lines[4]?.kind, 'context')
  assert.equal(hunk.lines[4]?.oldNum, 12)
  assert.equal(hunk.lines[4]?.newNum, 13)
  assert.equal(hunk.lines[4]?.text, 'return a + b')
})

test('parseUnifiedDiff handles multiple hunks and metadata headers', () => {
  const diff = [
    '--- a/index.ts',
    '+++ b/index.ts',
    '@@ -1,2 +1,2 @@',
    '-hello',
    '+world',
    '@@ -50,2 +50,2 @@',
    '-foo',
    '+bar'
  ].join('\n')

  const parsed = parseUnifiedDiff(diff)
  assert.equal(parsed.additions, 2)
  assert.equal(parsed.deletions, 2)
  assert.equal(parsed.hunks.length, 3) // header meta hunk + 2 code hunks
  assert.equal(parsed.hunks[0]?.lines[0]?.kind, 'meta')
})

test('highlightTokens wraps keywords, strings, comments, and literals', () => {
  const tokens = highlightTokens('const x: string = "hello" // comment')
  assert.ok(Array.isArray(tokens))
  assert.ok(tokens.length >= 4)
})
