import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { selectFavicon } from './browser-favicon.ts'

test('chooses the first usable page favicon URL', () => {
  assert.equal(
    selectFavicon(['not a url', 'https://example.com/favicon.svg', 'https://example.com/favicon.png']),
    'https://example.com/favicon.svg'
  )
})

test('allows ordinary http icons but rejects non-web candidates', () => {
  assert.equal(selectFavicon(['data:image/png;base64,abc', 'http://localhost:3000/favicon.ico']), 'http://localhost:3000/favicon.ico')
  assert.equal(selectFavicon(['javascript:alert(1)', 'file:///tmp/favicon.ico']), null)
})

test('renderer CSP can display every favicon scheme the browser accepts', async () => {
  const html = await readFile(new URL('../renderer/index.html', import.meta.url), 'utf8')
  const imageDirective = html.match(/img-src ([^;]+);/)?.[1].split(/\s+/) ?? []

  for (const candidate of ['http://localhost/favicon.ico', 'https://example.com/favicon.ico']) {
    const favicon = selectFavicon([candidate])
    assert.ok(favicon)
    assert.ok(imageDirective.includes(new URL(favicon).protocol))
  }
})
