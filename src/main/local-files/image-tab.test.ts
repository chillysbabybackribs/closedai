import assert from 'node:assert/strict'
import test from 'node:test'
import { ImageTab, imageKey, validateImageSource } from './image-tab.js'

const src = 'data:image/png;base64,aGVsbG8='

test('image tab snapshots contain identity, never image bytes, and preserve filename when renamed', () => {
  const tab = new ImageTab('tab-2', '/tmp/a #b.png', { name: 'a #b.png', path: '/tmp/a #b.png', src }, 'tab-1')
  assert.deepEqual(tab.getState().image, { tabId: 'tab-2', name: 'a #b.png', path: '/tmp/a #b.png' })
  assert.equal(tab.getState().url, 'file:///tmp/a%20%23b.png')
  assert.ok(!JSON.stringify(tab.getState()).includes(src))
  tab.rename('Reference')
  assert.equal(tab.getCustomTitle(), 'Reference')
  assert.equal(tab.content.name, 'a #b.png')
  assert.equal(tab.exportNavigationStack(), null)
})

test('image identity deduplicates local paths and attachment bytes independently of the label', () => {
  assert.equal(imageKey({ name: 'a', src }), imageKey({ name: 'b', src }))
  assert.equal(imageKey({ name: 'a', path: '/tmp/a.png', src }), '/tmp/a.png')
  assert.notEqual(imageKey({ name: 'a', src }), imageKey({ name: 'a', src: src + 'a' }))
})

test('attachment viewer rejects executable schemes, SVG documents and unbounded payloads', () => {
  for (const source of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html;base64,aA==', 'data:image/svg+xml;base64,aA==']) {
    assert.throws(() => validateImageSource({ name: 'image', src: source }), /not supported/)
  }
  assert.deepEqual(validateImageSource({ name: 'image', src }), { name: 'image', src })
  assert.equal(validateImageSource({ name: 'web', src: 'https://example.com/image.png' }).name, 'web')
  assert.throws(() => validateImageSource({ name: 'huge', src: 'data:image/png;base64,' + 'a'.repeat(45 * 1024 * 1024) }), /32 MB/)
})
