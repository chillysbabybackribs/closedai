import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  alignHunkLines,
  DiffViewer,
  formatHunkRaw,
  highlightTokens,
  parseUnifiedDiff
} from './diff-viewer.js'

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

test('alignHunkLines pairs additions and deletions side-by-side with padding', () => {
  const diff = [
    '@@ -10,3 +10,4 @@ function test()',
    ' const a = 1',
    '-const b = 2',
    '+const b = 3',
    '+const c = 4',
    ' return a + b'
  ].join('\n')

  const parsed = parseUnifiedDiff(diff)
  const rows = alignHunkLines(parsed.hunks[0]!.lines)
  assert.equal(rows.length, 4)

  // Row 0: context
  assert.equal(rows[0]?.left.kind, 'context')
  assert.equal(rows[0]?.left.num, 10)
  assert.equal(rows[0]?.right.kind, 'context')
  assert.equal(rows[0]?.right.num, 10)

  // Row 1: remove paired with add
  assert.equal(rows[1]?.left.kind, 'remove')
  assert.equal(rows[1]?.left.num, 11)
  assert.equal(rows[1]?.left.text, 'const b = 2')
  assert.equal(rows[1]?.right.kind, 'add')
  assert.equal(rows[1]?.right.num, 11)
  assert.equal(rows[1]?.right.text, 'const b = 3')

  // Row 2: empty left paired with second add
  assert.equal(rows[2]?.left.kind, 'empty')
  assert.equal(rows[2]?.left.num, null)
  assert.equal(rows[2]?.right.kind, 'add')
  assert.equal(rows[2]?.right.num, 12)
  assert.equal(rows[2]?.right.text, 'const c = 4')

  // Row 3: context
  assert.equal(rows[3]?.left.kind, 'context')
  assert.equal(rows[3]?.left.num, 12)
  assert.equal(rows[3]?.right.kind, 'context')
  assert.equal(rows[3]?.right.num, 13)
})

test('formatHunkRaw reconstructs raw diff hunk string', () => {
  const diff = [
    '@@ -1,2 +1,2 @@',
    '-hello',
    '+world'
  ].join('\n')

  const parsed = parseUnifiedDiff(diff)
  const formatted = formatHunkRaw(parsed.hunks[0]!)
  assert.equal(formatted, diff)
})

test('highlightTokens wraps keywords, strings, comments, and literals', () => {
  const tokens = highlightTokens('const x: string = "hello" // comment')
  assert.ok(Array.isArray(tokens))
  assert.ok(tokens.length >= 4)
})

test('DiffViewer renders unified view with stat bar, mode toggle and hunk actions', () => {
  const diff = [
    '@@ -10,2 +10,2 @@',
    '-oldCode()',
    '+newCode()'
  ].join('\n')

  const html = renderToStaticMarkup(createElement(DiffViewer, {
    path: 'src/example.ts',
    diff
  }))

  assert.match(html, /src\/example\.ts/)
  assert.match(html, /data-ui="chat\.local-file"/)
  assert.match(html, /class="diff-stat-add"/)
  assert.match(html, /\+1/)
  assert.match(html, /class="diff-stat-del"/)
  assert.match(html, /-1/)
  assert.match(html, /class="diff-stat-bar"/)
  assert.match(html, /data-ui="diff\.toggle-view" data-ui-key="unified"/)
  assert.match(html, /data-ui="diff\.toggle-view" data-ui-key="split"/)
  assert.match(html, /data-ui="diff\.collapse-hunk" data-ui-key="0"/)
  assert.match(html, /data-ui="diff\.copy-hunk" data-ui-key="0"/)
  assert.match(html, /diff-row-remove/)
  assert.match(html, /diff-row-add/)
})

test('DiffViewer renders split view mode with dual panes', () => {
  const diff = [
    '@@ -10,2 +10,2 @@',
    '-oldCode()',
    '+newCode()'
  ].join('\n')

  const html = renderToStaticMarkup(createElement(DiffViewer, {
    path: 'src/example.ts',
    diff,
    defaultViewMode: 'split'
  }))

  assert.match(html, /diff-table-split/)
  assert.match(html, /diff-split-left diff-split-remove/)
  assert.match(html, /diff-split-right diff-split-add/)
  assert.match(html, /class="diff-mode-btn is-active" data-ui="diff\.toggle-view" data-ui-key="split"/)
})

test('DiffViewer renders collapse-all button when multi-hunk diff exists', () => {
  const diff = [
    '@@ -1,2 +1,2 @@',
    '-foo',
    '+bar',
    '@@ -20,2 +20,2 @@',
    '-alpha',
    '+beta'
  ].join('\n')

  const html = renderToStaticMarkup(createElement(DiffViewer, {
    path: 'src/multi.ts',
    diff
  }))

  assert.match(html, /data-ui="diff\.collapse-all"/)
  assert.match(html, /Collapse all/)
})
