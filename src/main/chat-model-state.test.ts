import assert from 'node:assert/strict'
import test from 'node:test'
import { ChatModelState } from './chat-model-state.js'

const catalog = {
  models: [{
    provider: 'codex' as const,
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
    provider: 'codex' as const,
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

test('a resumed thread fills in only what the pane has not chosen', () => {
  const state = new ChatModelState()
  state.load(catalog)
  // The saved choice survives a thread that last ran on another model and effort.
  state.adoptResumed({ model: 'luna', effort: 'low' }, { model: 'sol', effort: 'high' })
  assert.deepEqual([state.selectedModel, state.selectedReasoningEffort], ['luna', 'low'])
  // A pane that never chose takes the thread's, and an unsaved effort still comes from it.
  state.adoptResumed({ model: null, effort: null }, { model: 'sol', effort: 'low' })
  assert.deepEqual([state.selectedModel, state.selectedReasoningEffort], ['sol', 'low'])
  state.adoptResumed({ model: 'sol', effort: null }, { model: 'luna', effort: 'medium' })
  assert.deepEqual([state.selectedModel, state.selectedReasoningEffort], ['sol', 'medium'])
})
