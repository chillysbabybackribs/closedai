import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatModel } from '../shared/chat.js'
import {
  effortLabel, effortMenuDetail, modelContextLabel, modelMenuDetail, modelGroups, modelTriggerLabel, parseRecentModels, pushRecentModel,
  RECENT_MODELS_KEPT, recentModels
} from './model-menu-state.js'

function model(provider: ChatModel['provider'], id: string, displayName: string, efforts: string[] = [], isDefault = false, contextWindow?: number): ChatModel {
  return {
    provider, id, displayName, description: `${displayName} description`, defaultReasoningEffort: 'high',
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: '' })), isDefault,
    ...(contextWindow ? { contextWindow } : {})
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

const models = [
  model('claude', 'claude:opus[1m]', 'Opus 5 (1M)', ['low', 'high']),
  model('codex', 'gpt-5.6-sol', 'GPT-5.6-Sol', ['low', 'xhigh'], false, 872_000),
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
  assert.deepEqual(modelTriggerLabel(models, 'gpt-5.6-sol', 'xhigh'), { name: 'GPT-5.6-Sol', context: '1M', effort: 'Xhigh', description: 'GPT-5.6-Sol description' })
  assert.equal(modelTriggerLabel(models, 'claude:haiku', 'high').effort, null)
  assert.equal(modelTriggerLabel(models, 'gpt-5.6-sol', 'ultra').effort, null)
  assert.deepEqual(modelTriggerLabel(models, null, null), { name: 'Choose model', context: null, effort: null, description: '' })
  assert.equal(modelTriggerLabel([], null, null).name, 'No models')
})

test('effort labels are title-cased', () => {
  assert.equal(effortLabel('medium'), 'Medium')
  assert.equal(effortLabel('x-high'), 'X High')
})

test('model menu detail strips subscription blurbs and caps length', () => {
  assert.equal(
    modelMenuDetail({
      ...model('cursor', 'x', 'Grok', [], false, 256_000),
      description: 'Thinking · high effort · 300k context — on your Cursor subscription'
    }),
    'Thinking · high effort · 300k context'
  )
  assert.equal(
    modelMenuDetail({ ...model('cursor', 'y', 'Auto'), description: 'On your Cursor subscription' }),
    null
  )
  assert.equal(
    modelMenuDetail({ ...model('codex', 'z', 'Sol'), description: '', contextWindow: 128_000 }),
    '128K context'
  )
  assert.equal(
    effortMenuDetail('Deeper than high; best for long agentic work and multi-step planning'),
    'Deeper than high; best for long agentic work…'
  )
})

test('context labels stay compact at common model-window sizes', () => {
  assert.equal(modelContextLabel(128_000), '128K')
  assert.equal(modelContextLabel(400_000), '400K')
  assert.equal(modelContextLabel(872_000), '1M')
  assert.equal(modelContextLabel(1_000_000), '1M')
  assert.equal(modelContextLabel(1_050_000), '1M')
  assert.equal(modelContextLabel(undefined), null)
})

test('recent models move to the end on reuse and keep a bounded history', () => {
  assert.deepEqual(pushRecentModel(['sol', 'terra', 'luna'], 'sol'), ['terra', 'luna', 'sol'])
  const long = Array.from({ length: RECENT_MODELS_KEPT }, (_, index) => `m${index}`)
  assert.deepEqual(pushRecentModel(long, 'new'), [...long.slice(1), 'new'])
})

test('the Recent block skips the current model and ones the catalogue lost, most recent last', () => {
  const recent = ['claude:sonnet', 'gone', 'sol', 'claude:haiku', 'spark', 'terra']
  assert.deepEqual(recentModels(catalogue, recent, 'terra').map((entry) => entry.id), ['sol', 'claude:haiku', 'spark'])
  assert.deepEqual(recentModels(catalogue, ['gone', 'sol'], null).map((entry) => entry.id), ['sol'])
})

test('stored recents survive a round trip and ignore junk', () => {
  assert.deepEqual(parseRecentModels(null), [])
  assert.deepEqual(parseRecentModels('not json'), [])
  assert.deepEqual(parseRecentModels('{"sol":3}'), [])
  assert.deepEqual(parseRecentModels('["sol", 4, "", "terra"]'), ['sol', 'terra'])
})
