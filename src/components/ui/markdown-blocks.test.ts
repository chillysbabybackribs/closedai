import assert from 'node:assert/strict'
import test from 'node:test'
import { lexMarkdownBlocks, splitMarkdownIntoBlocks, type MarkdownBlockCache } from './markdown-blocks.js'

test('lexMarkdownBlocks concatenates back to the source', () => {
  const source = '# Title\n\nParagraph **one**.\n\n- item\n'
  assert.equal(lexMarkdownBlocks(source).join(''), source)
})

test('splitMarkdownIntoBlocks reuses settled blocks while the tail grows', () => {
  const base = '# Title\n\nParagraph one.\n\nPara'
  let cache: MarkdownBlockCache | null = null
  cache = splitMarkdownIntoBlocks(base, true, cache)
  const settledCount = cache.blocks.length
  assert.ok(settledCount >= 1)

  const extended = `${base}graph two.`
  const next = splitMarkdownIntoBlocks(extended, true, cache)
  assert.equal(next.blocks.slice(0, -1).join(''), cache.blocks.slice(0, -1).join(''))
  assert.equal(next.blocks.join(''), extended)
})

test('splitMarkdownIntoBlocks full lexes after shrink or when not streaming', () => {
  const first = 'Hello **wor'
  let cache = splitMarkdownIntoBlocks(first, true, null)
  const shorter = 'Hello'
  const afterShrink = splitMarkdownIntoBlocks(shorter, true, cache)
  assert.equal(afterShrink.markdown, shorter)
  assert.equal(afterShrink.blocks.join(''), shorter)

  cache = splitMarkdownIntoBlocks('Line one\n\nLine two', true, null)
  const settled = splitMarkdownIntoBlocks('Line one\n\nLine two!', false, cache)
  assert.equal(settled.blocks.join(''), 'Line one\n\nLine two!')
})
