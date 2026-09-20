import assert from 'node:assert/strict'
import test from 'node:test'
import {
  antigravityContextWindow,
  antigravityModelCatalog,
  antigravityModelsFromCli,
  antigravityWireModel,
  parseAntigravityModelList
} from './antigravity-models.js'

// Listing recorded from `agy models` 1.1.24 on 2026-09-02.
const LISTING = `Fetching available models...
gemini-3.8-flash-high\tGemini 3.8 Flash (High)
gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)
gemini-3.8-flash-low\tGemini 3.8 Flash (Low)
gemini-3.1-pro-high\tGemini 3.1 Pro (High)
gemini-3.1-pro-low\tGemini 3.1 Pro (Low)
claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)
gpt-oss-120b-medium\tGPT-OSS 120B (Medium)
`

test('the listing parses to id/name pairs, skipping the banner', () => {
  const models = parseAntigravityModelList(LISTING)
  assert.equal(models.length, 7)
  assert.deepEqual(models[0], { id: 'gemini-3.8-flash-high', displayName: 'Gemini 3.8 Flash (High)' })
})

test('effort variants collapse into one family with the suffixes as effort options', () => {
  const models = antigravityModelsFromCli(parseAntigravityModelList(LISTING))
  assert.deepEqual(models.map((model) => model.id), ['agy:gemini-3.8-flash', 'agy:gemini-3.1-pro', 'agy:claude-sonnet-4-6', 'agy:gpt-oss-120b'])
  const flash = models[0]!
  assert.equal(flash.displayName, 'Gemini 3.8 Flash')
  assert.equal(flash.provider, 'antigravity')
  assert.equal(flash.isDefault, true)
  assert.deepEqual(flash.supportedReasoningEfforts.map((option) => option.reasoningEffort), ['low', 'medium', 'high'])
  assert.equal(flash.defaultReasoningEffort, 'high')
  assert.equal(flash.contextWindow, 1_000_000)
  const pro = models[1]!
  assert.deepEqual(pro.supportedReasoningEfforts.map((option) => option.reasoningEffort), ['low', 'high'])
  assert.equal(pro.contextWindow, 1_000_000)
  const sonnet = models[2]!
  assert.equal(sonnet.displayName, 'Claude Sonnet 4.6')
  assert.deepEqual(sonnet.supportedReasoningEfforts, [])
  assert.equal(sonnet.contextWindow, 200_000)
  assert.equal(models[3]!.defaultReasoningEffort, 'medium')
  assert.equal(models[3]!.contextWindow, 128_000)
})

test('the wire model re-attaches the chosen effort, falling back to the default', () => {
  const models = antigravityModelsFromCli(parseAntigravityModelList(LISTING))
  assert.equal(antigravityWireModel(models, 'agy:gemini-3.8-flash', 'low'), 'gemini-3.8-flash-low')
  assert.equal(antigravityWireModel(models, 'agy:gemini-3.1-pro', 'medium'), 'gemini-3.1-pro-high')
  assert.equal(antigravityWireModel(models, 'agy:claude-sonnet-4-6', 'high'), 'claude-sonnet-4-6')
  assert.equal(antigravityWireModel(models, 'claude:opus', 'high'), null)
  assert.equal(antigravityWireModel(models, null, null), null)
})

test('the catalog applies the saved preference when it still exists', () => {
  const cliModels = parseAntigravityModelList(LISTING)
  const kept = antigravityModelCatalog(cliModels, 'agy:gemini-3.1-pro', 'low')
  assert.equal(kept.selectedModel, 'agy:gemini-3.1-pro')
  assert.equal(kept.selectedReasoningEffort, 'low')
  const dropped = antigravityModelCatalog(cliModels, 'agy:gemini-3.5-flash', 'medium')
  assert.equal(dropped.selectedModel, 'agy:gemini-3.8-flash')
  assert.equal(dropped.selectedReasoningEffort, 'medium')
})

test('antigravityContextWindow assigns context capacities according to model family', () => {
  assert.equal(antigravityContextWindow('gemini-3.8-flash'), 1_000_000)
  assert.equal(antigravityContextWindow('agy:gemini-3.1-pro'), 1_000_000)
  assert.equal(antigravityContextWindow('claude-sonnet-4-6'), 200_000)
  assert.equal(antigravityContextWindow('agy:claude-opus-4-6-thinking'), 200_000)
  assert.equal(antigravityContextWindow('gpt-oss-120b-medium'), 128_000)
  assert.equal(antigravityContextWindow('agy:gpt-oss-120b'), 128_000)
  assert.equal(antigravityContextWindow(null), 1_000_000)
  assert.equal(antigravityContextWindow(''), 1_000_000)
})
