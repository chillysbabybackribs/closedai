import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Markdown } from '../components/ui/markdown.js'

test('renders the rich Prompt Kit markdown elements used in chat responses', () => {
  const source = [
    '# Markdown Example',
    '',
    'This is **bold** and *italic*.',
    '',
    '- Item one',
    '- Item two',
    '',
    '1. First',
    '2. Second',
    '',
    '[Prompt Kit](https://prompt-kit.com)',
    '',
    'Inline `code`.',
    '',
    '```javascript',
    'const answer = 42',
    '```'
  ].join('\n')

  const html = renderToStaticMarkup(createElement(Markdown, null, source))

  for (const element of ['h1', 'strong', 'em', 'ul', 'ol', 'a', 'pre', 'code']) {
    assert.match(html, new RegExp(`<${element}(?: |>)`))
  }
  assert.match(html, /class="prompt-source-trigger prompt-source-trigger-favicon"/)
  assert.match(html, />prompt-kit\.com<\/span>/)
  assert.match(html, /google\.com\/s2\/favicons/)
})

test('does not turn unsafe markdown links into source cards', () => {
  const html = renderToStaticMarkup(createElement(Markdown, null, '[unsafe](javascript:alert(1))'))

  assert.doesNotMatch(html, /prompt-source-trigger/)
  assert.doesNotMatch(html, /javascript:/)
})

test('links bare hosts that remark-gfm leaves as plain text', () => {
  const source = 'Compare untitledui.com and tailwindcss.com/plus before buying.'
  const html = renderToStaticMarkup(createElement(Markdown, null, source))

  assert.match(html, /href="https:\/\/untitledui\.com\/"/)
  assert.match(html, /href="https:\/\/tailwindcss\.com\/plus"/)
  assert.match(html, /prompt-source-trigger/)
})

test('links bare hosts inside table cells and list items', () => {
  const source = [
    '| Site | Note |',
    '| --- | --- |',
    '| **alignui.com** | dashboards |',
    '',
    '- tremor.so for charts'
  ].join('\n')
  const html = renderToStaticMarkup(createElement(Markdown, null, source))

  assert.match(html, /href="https:\/\/alignui\.com\/"/)
  assert.match(html, /href="https:\/\/tremor\.so\/"/)
})

test('leaves sentence punctuation and wrapping parentheses outside the link', () => {
  const html = renderToStaticMarkup(createElement(Markdown, null, 'See (vercel.com/geist).'))

  assert.match(html, /href="https:\/\/vercel\.com\/geist"/)
  assert.doesNotMatch(html, /geist\)/)
})

test('does not link file paths, code spans, or existing links', () => {
  const source = [
    'Edit src/renderer/chat-transcript.tsx and package.json now.',
    '',
    '`untitledui.com`',
    '',
    '[Untitled UI](https://www.untitledui.com/pricing)'
  ].join('\n')
  const html = renderToStaticMarkup(createElement(Markdown, null, source))

  assert.doesNotMatch(html, /href="https:\/\/[^"]*chat-transcript/)
  assert.doesNotMatch(html, /href="https:\/\/package\.json"/)
  assert.doesNotMatch(html, /href="https:\/\/untitledui\.com\/"/)
  assert.match(html, /href="https:\/\/www\.untitledui\.com\/pricing"/)
})
