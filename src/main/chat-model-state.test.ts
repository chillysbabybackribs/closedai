import assert from 'node:assert/strict'
import test from 'node:test'
import { ChatModelState } from './chat-model-state.js'

const catalog = {
  models: [{
    id: 'sol',
    displayName: 'Sol',
    description: '',
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: '' },
      { reasoningEffort: 'medium', description: '' },
      { reasoningEffort: 'high', description: '' }
    ],
    isDefault: true
  }, {
    id: 'luna',
    displayName: 'Luna',
    description: '',
    defaultReasoningEffort: 'low',
    supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }],
    isDefault: false
  }],
  selectedModel: 'sol',
  selectedReasoningEffort: 'high'
}

test('model changes preserve a compatible effort and otherwise use the model default', () => {
  const state = new ChatModelState()
  state.load(catalog)
  assert.deepEqual(state.preferenceForModel('sol'), { model: 'sol', effort: 'high' })
  assert.deepEqual(state.preferenceForModel('luna'), { model: 'luna', effort: 'low' })
})

test('effort changes are limited to the selected model choices', () => {
  const state = new ChatModelState()
  state.load(catalog)
  assert.deepEqual(state.preferenceForEffort('low'), { model: 'sol', effort: 'low' })
  assert.throws(() => state.preferenceForEffort('ultra'), /not available/)
})
