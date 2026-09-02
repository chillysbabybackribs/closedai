import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeItem } from './chat-normalizers.js'

test('completed capture calls become transcript screenshots', () => {
  const item = normalizeItem({
    type: 'dynamicToolCall',
    id: 'raw-id',
    namespace: 'closedai_ui',
    tool: 'capture',
    arguments: { action: 'browser_page' },
    status: 'completed',
    contentItems: [
      { type: 'inputText', text: 'Page: Example\nURL: https://example.test/' },
      { type: 'inputImage', imageUrl: 'data:image/png;base64,cG5n' }
    ]
  }, 'capture-1', 'turn-1', true)

  assert.deepEqual(item, {
    type: 'screenshot',
    id: 'capture-1',
    turnId: 'turn-1',
    imageUrl: 'data:image/png;base64,cG5n',
    surface: 'browser_page',
    caption: 'Page: Example'
  })
})

test('capture calls stay ordinary tool rows until a successful image exists', () => {
  const started = normalizeItem({
    type: 'dynamicToolCall', namespace: 'closedai_ui', tool: 'capture',
    arguments: { action: 'app_window' }, status: 'inProgress', contentItems: null
  }, 'capture-2', 'turn-1', false)
  assert.equal(started?.type, 'tool')

  const failed = normalizeItem({
    type: 'dynamicToolCall', namespace: 'closedai_ui', tool: 'capture',
    arguments: { action: 'app_window' }, status: 'completed', contentItems: [{ type: 'inputText', text: 'Unavailable' }]
  }, 'capture-3', 'turn-1', true)
  assert.equal(failed?.type, 'tool')
})
