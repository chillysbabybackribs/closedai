import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ChatModel } from '../shared/chat.js'
import { ModelFlyoutBody, ModelPicker } from './composer-model-picker.tsx'
import { modelGroups } from './model-menu-state.js'

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
    disabled: false,
    boundary: null,
    onChoose: () => {},
    ...props
  }))
}

function renderFlyout(props: Partial<Parameters<typeof ModelFlyoutBody>[0]> = {}): string {
  return renderToStaticMarkup(createElement(ModelFlyoutBody, {
    group: modelGroups(models).find((group) => group.provider === 'cursor')!,
    selectedModel: 'cursor-0',
    newThread: false,
    disabled: false,
    onBack: () => {},
    onChoose: () => {},
    ...props
  }))
}

test('the panel lists only providers, naming the model in use on its own provider', () => {
  const html = render()
  assert.match(html, /data-ui="composer\.model-provider" data-ui-key="codex"[\s\S]*data-ui-key="cursor"[\s\S]*Cursor 0/)
  assert.doesNotMatch(html, /composer\.model-item|Recent/)
})

test("a provider's flyout lists every model with the current one checked", () => {
  const html = renderFlyout()
  assert.match(html, /data-ui="composer\.model-item" data-ui-key="cursor-7"/)
  assert.match(html, /data-ui-key="cursor-0" data-checked="true"/)
  assert.doesNotMatch(html, /new thread/)
  assert.match(renderFlyout({ newThread: true }), /Starts a new thread/)
})

test('effort sits under the models when this provider owns the selection', () => {
  assert.match(renderFlyout({ effort: createElement('p', null, 'EFFORT') }), /cursor-7[\s\S]*EFFORT/)
})

test('while locked only the current model stays enabled', () => {
  const html = renderFlyout({ disabled: true })
  assert.match(html, /data-ui-key="cursor-1"[^>]*data-disabled="true"/)
  assert.match(html, /data-ui-key="cursor-0"[^>]*data-disabled="false"/)
})

test('the picker says so when there are no models', () => {
  assert.match(render({ models: [], selectedModel: null }), /No models are available yet/)
})
