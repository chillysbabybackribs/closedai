import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatModel } from '../shared/chat.js'
import { effortLabel, modelGroups, modelTriggerLabel } from './model-menu.js'

function model(provider: ChatModel['provider'], id: string, displayName: string, efforts: string[] = []): ChatModel {
  return {
    provider, id, displayName, description: `${displayName} description`, defaultReasoningEffort: 'high',
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: '' })), isDefault: false
  }
}

const models = [
  model('claude', 'claude:opus[1m]', 'Opus 5 (1M)', ['low', 'high']),
  model('codex', 'gpt-5.6-sol', 'GPT-5.6-Sol', ['low', 'xhigh']),
  model('claude', 'claude:haiku', 'Haiku 4.5')
]

test('groups keep a fixed provider order and drop empty providers', () => {
  assert.deepEqual(modelGroups(models).map((group) => [group.label, group.models.map((entry) => entry.id)]), [
    ['Codex', ['gpt-5.6-sol']],
    ['Claude Code', ['claude:opus[1m]', 'claude:haiku']]
  ])
  assert.deepEqual(modelGroups(models.slice(0, 1)).map((group) => group.provider), ['claude'])
})

test('the trigger reads the model name with the effort as a suffix only when it applies', () => {
  assert.deepEqual(modelTriggerLabel(models, 'gpt-5.6-sol', 'xhigh'), { name: 'GPT-5.6-Sol', effort: 'Xhigh', description: 'GPT-5.6-Sol description' })
  assert.equal(modelTriggerLabel(models, 'claude:haiku', 'high').effort, null)
  assert.equal(modelTriggerLabel(models, 'gpt-5.6-sol', 'ultra').effort, null)
  assert.deepEqual(modelTriggerLabel(models, null, null), { name: 'Choose model', effort: null, description: '' })
  assert.equal(modelTriggerLabel([], null, null).name, 'No models')
})

test('effort labels are title-cased', () => {
  assert.equal(effortLabel('medium'), 'Medium')
  assert.equal(effortLabel('x-high'), 'X High')
})
