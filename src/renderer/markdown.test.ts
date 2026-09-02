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
