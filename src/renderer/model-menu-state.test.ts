import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatModel } from '../shared/chat.js'
import {
  effortLabel, effortMenuDetail, modelBlurb, modelContextLabel, modelFlyoutPlacement, modelMenuDetail, modelGroups, modelTriggerLabel
} from './model-menu-state.js'

function model(provider: ChatModel['provider'], id: string, displayName: string, efforts: string[] = [], isDefault = false, contextWindow?: number): ChatModel {
  return {
    provider, id, displayName, description: `${displayName} description`, defaultReasoningEffort: 'high',
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: '' })), isDefault,
    ...(contextWindow ? { contextWindow } : {})
  }
}

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

test('row tooltips keep a model blurb and drop the shared subscription line', () => {
  assert.equal(modelBlurb({ ...model('antigravity', 'a', 'GPT-OSS'), description: 'On your Antigravity subscription' }), null)
  assert.equal(modelBlurb({ ...model('cursor', 'b', 'Grok'), description: 'Fast coding — on your Cursor subscription' }), 'Fast coding')
})

const pane = { left: 0, right: 1000, width: 1000 }

test('the flyout opens on the side with room, growing the way the panel opened', () => {
  // Panel near the pane's left edge: room on the right, just past the row's 5px inset.
  assert.deepEqual(
    modelFlyoutPlacement({ left: 40, right: 328, width: 288 }, { left: 45, right: 323, width: 278 }, pane, 'top'),
    { side: 'right', align: 'end', sideOffset: 11, width: 260 }
  )
  // Panel against the right edge (the screenshot case): it flips left and drops down when the panel did.
  assert.deepEqual(
    modelFlyoutPlacement({ left: 700, right: 988, width: 288 }, { left: 705, right: 983, width: 278 }, pane, 'bottom'),
    { side: 'left', align: 'start', sideOffset: 11, width: 260 }
  )
})

test('in a pane too narrow for either side the flyout overlaps the panel and stays inside', () => {
  const narrow = { left: 0, right: 420, width: 420 }
  const placement = modelFlyoutPlacement({ left: 60, right: 348, width: 288 }, { left: 65, right: 343, width: 278 }, narrow, 'top')
  assert.equal(placement.side, 'right')
  // Row right edge 343 + offset + width 260 must end at the pane's padded edge, 408.
  assert.equal(343 + placement.sideOffset + placement.width, 408)
  assert.equal(modelFlyoutPlacement(pane, pane, { left: 0, right: 200, width: 200 }, 'top').width, 176)
})
