import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeItem, normalizeModels } from './chat-normalizers.js'

test('models retain their advertised reasoning effort choices', () => {
  const models = normalizeModels([{
    id: 'sol',
    displayName: 'Sol',
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Quick' },
      { reasoningEffort: 'high', description: 'Deep' },
      { description: 'Invalid option' }
    ]
  }])
  assert.deepEqual(models[0]?.supportedReasoningEfforts, [
    { reasoningEffort: 'low', description: 'Quick' },
    { reasoningEffort: 'high', description: 'Deep' }
  ])
})

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

test('completed crop calls become crop screenshots', () => {
  const item = normalizeItem({
    type: 'dynamicToolCall',
    namespace: 'closedai_ui',
    tool: 'capture',
    arguments: { action: 'crop', source_id: 'capture-1', x: 10, y: 20, width: 30, height: 40 },
    status: 'completed',
    contentItems: [
      { type: 'inputText', text: 'Crop of: capture-1\nRegion: (10, 20) 30x40' },
      { type: 'inputImage', imageUrl: 'data:image/jpeg;base64,Y3JvcA==' }
    ]
  }, 'crop-1', 'turn-1', true)

  assert.deepEqual(item, {
    type: 'screenshot',
    id: 'crop-1',
    turnId: 'turn-1',
    imageUrl: 'data:image/jpeg;base64,Y3JvcA==',
    surface: 'crop',
    caption: 'Crop of: capture-1'
  })
})

test('reasoning and plan items stream until the item is completed', () => {
  const live = normalizeItem({ type: 'reasoning', summary: ['a'] }, 'r1', 't1', false)
  assert.deepEqual(live, { type: 'reasoning', id: 'r1', turnId: 't1', text: 'a', streaming: true })
  const done = normalizeItem({ type: 'reasoning', summary: ['a'] }, 'r1', 't1', true)
  assert.equal(done?.type === 'reasoning' && done.streaming, false)
  const plan = normalizeItem({ type: 'plan', text: 'steps' }, 'p1', 't1', false)
  assert.equal(plan?.type === 'plan' && plan.streaming, true)
})

test('dynamic tool calls receive descriptive semantic labels', () => {
  const readPage = normalizeItem({
    type: 'dynamicToolCall', namespace: 'embedded_browser', tool: 'page', arguments: { action: 'read_page' }, status: 'inProgress'
  }, 't1', 'turn-1', false)
  assert.equal(readPage?.type === 'tool' && readPage.label, 'Read page')

  const openPage = normalizeItem({
    type: 'dynamicToolCall', namespace: 'embedded_browser', tool: 'page', arguments: { action: 'navigate', url: 'https://example.com' }, status: 'completed'
  }, 't2', 'turn-1', true)
  assert.equal(openPage?.type === 'tool' && openPage.label, 'Open page')

  const cdpPage = normalizeItem({
    type: 'dynamicToolCall', namespace: 'browser_cdp', tool: 'page', arguments: { action: 'inspect_page' }, status: 'completed'
  }, 't3', 'turn-1', true)
  assert.equal(cdpPage?.type === 'tool' && cdpPage.label, 'Analyze page')

  const appPage = normalizeItem({
    type: 'dynamicToolCall', namespace: 'closedai_app', tool: 'page', arguments: { action: 'inspect_app' }, status: 'completed'
  }, 't4', 'turn-1', true)
  assert.equal(appPage?.type === 'tool' && appPage.label, 'Analyze app')

  const inspect = normalizeItem({
    type: 'dynamicToolCall', namespace: 'closedai_workspace', tool: 'inspect', arguments: { action: 'map' }, status: 'completed'
  }, 't5', 'turn-1', true)
  assert.equal(inspect?.type === 'tool' && inspect.label, 'Analyze workspace')

  const query = normalizeItem({
    type: 'dynamicToolCall', namespace: 'search', tool: 'query', arguments: { query: 'codex' }, status: 'completed'
  }, 't6', 'turn-1', true)
  assert.equal(query?.type === 'tool' && query.label, 'Web search')
})

