import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatModel } from '../shared/chat.js'
import { countModelUse, effortLabel, modelGroups, modelSections, modelTriggerLabel, parseModelUsage } from './model-menu-state.js'

function model(provider: ChatModel['provider'], id: string, displayName: string, efforts: string[] = [], isDefault = false): ChatModel {
  return {
    provider, id, displayName, description: `${displayName} description`, defaultReasoningEffort: 'high',
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: '' })), isDefault
  }
}

const catalogue = [
  model('codex', 'sol', 'Sol'),
  model('codex', 'terra', 'Terra', [], true),
  model('codex', 'luna', 'Luna'),
  model('codex', 'gpt-5.5', 'GPT-5.5'),
  model('codex', 'spark', 'Spark'),
  model('claude', 'claude:opus', 'Opus 5'),
  model('claude', 'claude:sonnet', 'Sonnet 5'),
  model('claude', 'claude:haiku', 'Haiku 4.5')
]

function featuredIds(sections: ReturnType<typeof modelSections>): string[] {
  return sections.featured.flatMap((group) => group.models.map((entry) => entry.id))
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

test('the menu opens on a short list that spans providers and folds the rest away', () => {
  const sections = modelSections(catalogue, {}, null)
  // Picked round-robin across providers with each one's default first, listed in menu order.
  assert.deepEqual(featuredIds(sections), ['sol', 'terra', 'luna', 'claude:opus', 'claude:sonnet'])
  assert.equal(sections.hiddenCount, 3)
  assert.equal(sections.all.flatMap((group) => group.models).length, catalogue.length)
})

test('the most used models are featured, and the selected one always is', () => {
  const usage = { spark: 9, 'claude:haiku': 7, 'gpt-5.5': 5 }
  // Grouped by provider for display, so the three used models, the selected one, and one
  // baseline filler come back in menu order rather than in rank order.
  assert.deepEqual(
    featuredIds(modelSections(catalogue, usage, 'claude:sonnet')),
    ['terra', 'gpt-5.5', 'spark', 'claude:sonnet', 'claude:haiku']
  )
  assert.deepEqual(featuredIds(modelSections(catalogue, usage, 'luna')), ['terra', 'luna', 'gpt-5.5', 'spark', 'claude:haiku'])
})

test('a remainder of one model is shown rather than hidden behind a row', () => {
  const sections = modelSections(catalogue.slice(0, 6), {}, null)
  assert.equal(sections.hiddenCount, 0)
  assert.equal(featuredIds(sections).length, 6)
})

test('usage counts survive a round trip and ignore junk', () => {
  assert.deepEqual(parseModelUsage(null), {})
  assert.deepEqual(parseModelUsage('not json'), {})
  assert.deepEqual(parseModelUsage('{"sol":3,"terra":"x","luna":0}'), { sol: 3 })
  assert.deepEqual(countModelUse({ sol: 3 }, 'sol'), { sol: 4 })
  assert.deepEqual(countModelUse({}, 'terra'), { terra: 1 })
})
