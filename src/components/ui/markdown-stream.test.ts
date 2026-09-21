import assert from 'node:assert/strict'
import test from 'node:test'

import { closeIncompleteMarkdown } from './markdown-stream.ts'

test('complete text passes through untouched', () => {
  const text = 'A **bold** claim with `code`, a ~~strike~~, and a [link](https://example.com).'
  assert.equal(closeIncompleteMarkdown(text), text)
})

test('unclosed bold and strikethrough are closed', () => {
  assert.equal(closeIncompleteMarkdown('This is **important'), 'This is **important**')
  assert.equal(closeIncompleteMarkdown('It was ~~wrong'), 'It was ~~wrong~~')
})

test('an unclosed inline code span is closed before any emphasis opened outside it', () => {
  assert.equal(closeIncompleteMarkdown('Run `npm tes'), 'Run `npm tes`')
  assert.equal(closeIncompleteMarkdown('**Use `arr.at'), '**Use `arr.at`**')
})

test('markers inside complete code spans never trigger closers', () => {
  const text = 'The pattern `a ** b` is literal'
  assert.equal(closeIncompleteMarkdown(text), text)
})

test('an incomplete trailing link or image is held back until it closes', () => {
  assert.equal(closeIncompleteMarkdown('See [the docs'), 'See ')
  assert.equal(closeIncompleteMarkdown('See [the docs](https://exa'), 'See ')
  assert.equal(closeIncompleteMarkdown('Shown ![alt tex'), 'Shown ')
  const complete = 'See [the docs](https://example.com) now'
  assert.equal(closeIncompleteMarkdown(complete), complete)
})

test('holding back a link still closes emphasis opened before it', () => {
  // The closer lands before the trailing space: `**Read **` would not parse as bold.
  assert.equal(closeIncompleteMarkdown('**Read [the guide](https://exa'), '**Read** ')
})

test('closers precede a trailing newline, where marked block raws end', () => {
  assert.equal(closeIncompleteMarkdown('This is **important\n'), 'This is **important**\n')
})

test('an unclosed code fence is left for the lexer to render as a code block', () => {
  const text = '```ts\nconst x = 1'
  assert.equal(closeIncompleteMarkdown(text), text)
})

test('a bracket inside an open code span is code, not a link', () => {
  assert.equal(closeIncompleteMarkdown('Use `arr['), 'Use `arr[`')
})
