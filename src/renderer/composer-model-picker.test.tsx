import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ChatModel } from '../shared/chat.js'
import { ModelPicker } from './composer-model-picker.tsx'

function model(id: string, provider: ChatModel['provider'], displayName = id): ChatModel {
  return { id, provider, displayName, description: '', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [], isDefault: false }
}

const models = [
  model('gpt-5', 'codex', 'GPT-5'),
  ...Array.from({ length: 8 }, (_, index) => model(`cursor-${index}`, 'cursor', `Cursor ${index}`))
]

function render(props: Partial<Parameters<typeof ModelPicker>[0]> = {}): string {
  return renderToStaticMarkup(createElement(ModelPicker, {
    models,
    selectedModel: 'cursor-0',
    provider: 'cursor',
    recent: [],
    disabled: false,
    onChoose: () => {},
    ...props
  }))
}

test('every model is listed under its provider, with nothing folded away', () => {
  const html = render()
  assert.match(html, /data-provider="codex"[\s\S]*GPT-5[\s\S]*data-provider="cursor"/)
  assert.match(html, /data-ui="composer\.model-item" data-ui-key="cursor-7"/)
  assert.doesNotMatch(html, /composer\.model-more|Filter/)
  assert.match(html, /data-ui-key="cursor-0" data-checked="true"/)
  assert.doesNotMatch(html, /data-ui-key="gpt-5" data-checked/)
})

test("another provider's section says choosing from it starts a new thread", () => {
  const html = render()
  assert.match(html, /Codex[^]*?new thread[^]*?data-provider="cursor"/)
  assert.equal(html.match(/new thread/g)?.length, 1)
})

test('Recent follows the effort footer and names each row’s provider', () => {
  const html = render({ recent: [models[0]!], footer: createElement('p', null, 'EFFORT') })
  assert.match(html, /EFFORT[\s\S]*Recent[\s\S]*data-ui="composer\.model-recent" data-ui-key="gpt-5"[\s\S]*Codex/)
  assert.doesNotMatch(render(), />Recent</)
})

test('while locked only the current model stays enabled', () => {
  const html = render({ disabled: true })
  assert.match(html, /data-ui-key="gpt-5"[^>]*data-disabled="true"/)
  assert.match(html, /data-ui-key="cursor-0"[^>]*data-disabled="false"/)
})

test('the picker says so when there are no models', () => {
  assert.match(render({ models: [], selectedModel: null }), /No models are available yet/)
})
