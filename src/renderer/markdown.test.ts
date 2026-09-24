import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Markdown } from '../components/ui/markdown.js'
import { LocalFileMarkdown } from './local-file-markdown.js'

test('chat file links are actionable, preserve labels, and keep unsafe links inert', () => {
  const html = renderToStaticMarkup(createElement(LocalFileMarkdown, {
    cwd: '/proj',
    children: '[**View mockups**](/tmp/my%20image.png) [Source](file:///tmp/code.ts#L12) [doc](docs/readme.md) [unsafe](javascript:alert(1))'
  }))
  assert.equal((html.match(/data-ui="chat.local-file"/g) ?? []).length, 3)
  assert.equal((html.match(/class="aui-md-local-file"/g) ?? []).length, 3)
  assert.doesNotMatch(html, /prompt-source-trigger/)
  assert.match(html, /<strong[^>]*>View mockups<\/strong>/)
  assert.match(html, /data-ui-key="file:\/\/\/tmp\/code.ts#L12"/)
  assert.doesNotMatch(html, /javascript:/)
})

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

test('tables render through the shadcn primitive and right-align numeric cells', () => {
  const source = [
    '| Tool | Latency | Share | Note |',
    '| --- | ---: | --- | --- |',
    '| Shofer | 1,240 ms | 42% | v2.5 beta |'
  ].join('\n')
  const html = renderToStaticMarkup(createElement(Markdown, null, source))

  assert.match(html, /<div data-slot="table-container" class="relative w-full overflow-x-auto"><table data-slot="table"/)
  assert.match(html, /<th data-slot="table-head" class="[^"]*whitespace-nowrap[^"]*text-right[^"]*">Latency<\/th>/)
  assert.match(html, /<td data-slot="table-cell" class="[^"]*tabular-nums whitespace-nowrap text-right[^"]*">42%<\/td>/)
  assert.match(html, /<td data-slot="table-cell" class="[^"]*whitespace-normal">Shofer<\/td>/)
  assert.match(html, /<td data-slot="table-cell" class="[^"]*whitespace-normal">v2\.5 beta<\/td>/)
})

test('leaves sentence punctuation and wrapping parentheses outside the link', () => {
  const html = renderToStaticMarkup(createElement(Markdown, null, 'See (vercel.com/geist).'))

  assert.match(html, /href="https:\/\/vercel\.com\/geist"/)
  assert.doesNotMatch(html, /geist\)/)
})

test('links bare workspace paths with a slash in chat markdown', () => {
  const html = renderToStaticMarkup(createElement(LocalFileMarkdown, {
    cwd: '/repo',
    children: 'Edit src/renderer/chat-transcript.tsx before shipping.'
  }))
  assert.match(html, /data-ui-key="src\/renderer\/chat-transcript.tsx"/)
})

test('links absolute paths and backtick file paths in chat markdown', () => {
  const html = renderToStaticMarkup(createElement(LocalFileMarkdown, {
    cwd: '/repo',
    children: 'Open /repo/README.md or `docs/application.md`'
  }))
  assert.match(html, /data-ui-key="\/repo\/README.md"/)
  assert.match(html, /data-ui-key="docs\/application.md"/)
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
