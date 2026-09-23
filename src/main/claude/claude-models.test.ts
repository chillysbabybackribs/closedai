import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import { claudeModelId, claudeModelValue, claudeSessionIdOf, claudeThreadId, isClaudeModelId, isClaudeThreadId } from './claude-ids.js'
import { claudeContextWindow, claudeDisplayName, claudeModelCatalog, claudeModelsFromInfo, resolveClaudeModelId, supportsAdaptiveThinking } from './claude-models.js'

// The catalog the CLI reported on 2026-09-02 (SDK 0.3.258), trimmed to the fields used.
const infos: ModelInfo[] = [
  { value: 'default', resolvedModel: 'claude-opus-5[1m]', displayName: 'Default (recommended)', description: 'Opus 5 with 1M context', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsAdaptiveThinking: true },
  { value: 'opus[1m]', resolvedModel: 'claude-opus-5[1m]', displayName: 'Opus (1M context)', description: 'Opus 5 with 1M context', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsAdaptiveThinking: true },
  { value: 'claude-fable-5-1[1m]', resolvedModel: 'claude-fable-5-1', displayName: 'Fable', description: 'Fable 5.1', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsAdaptiveThinking: true },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku', description: 'Haiku 4.5' }
]

test('ids round-trip through the claude prefix and reject foreign ids', () => {
  assert.equal(claudeModelId('opus[1m]'), 'claude:opus[1m]')
  assert.equal(claudeModelValue('claude:opus[1m]'), 'opus[1m]')
  assert.equal(claudeModelValue('gpt-5.6-sol'), null)
  assert.equal(isClaudeModelId('claude:'), false)
  assert.equal(isClaudeModelId(null), false)
  assert.equal(claudeThreadId('abc'), 'claude:abc')
  assert.equal(claudeSessionIdOf('claude:abc'), 'abc')
  assert.equal(isClaudeThreadId('0f7c0c9c-1c1e-4c7a-9f8b-3a1f6d2e9a10'), false)
})

test('context window follows tier markers and family defaults', () => {
  assert.equal(claudeContextWindow({ value: 'opus[1m]', resolvedModel: 'claude-opus-5[1m]', displayName: 'Opus', description: '' }), 1_000_000)
  assert.equal(claudeContextWindow({ value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet', description: '' }), 200_000)
})

test('catalog collapses aliases, keeps the CLI default, and carries effort levels', () => {
  const models = claudeModelsFromInfo(infos)
  assert.deepEqual(models.map((model) => model.id), ['claude:haiku', 'claude:claude-fable-5-1[1m]', 'claude:opus[1m]'])
  assert.equal(models[2]!.contextWindow, 1_000_000)
  assert.equal(models[0]!.contextWindow, 200_000)
  assert.equal(models.find((model) => model.isDefault)?.id, 'claude:opus[1m]')
  assert.equal(models[0]!.provider, 'claude')
  assert.equal(models[0]!.defaultReasoningEffort, 'high')
  const opus = models.find((model) => model.id === 'claude:opus[1m]')!
  assert.deepEqual(opus.supportedReasoningEfforts.map((option) => option.reasoningEffort), ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(models.find((model) => model.id === 'claude:haiku')!.supportedReasoningEfforts, [])
})

test('display names carry the full version and context tier', () => {
  assert.deepEqual(claudeModelsFromInfo(infos).map((model) => model.displayName), ['Haiku 4.5', 'Fable 5.1 (1M)', 'Opus 5 (1M)'])
  assert.equal(claudeDisplayName({ value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet' }), 'Sonnet 5')
  assert.equal(claudeDisplayName({ value: 'custom', resolvedModel: 'my-gateway-model', displayName: 'Gateway' }), 'Gateway')
})

test('catalog falls back to the first model as default when the CLI names none', () => {
  const models = claudeModelsFromInfo(infos.slice(2))
  assert.equal(models[0]!.isDefault, true)
  assert.equal(models[1]!.isDefault, false)
})

test('catalog preference: saved model and effort when valid, else defaults', () => {
  const saved = claudeModelCatalog(infos, 'claude:haiku', 'xhigh')
  assert.equal(saved.selectedModel, 'claude:haiku')
  assert.equal(saved.selectedReasoningEffort, null)
  const foreign = claudeModelCatalog(infos, 'gpt-5.6-sol', 'ultra')
  assert.equal(foreign.selectedModel, 'claude:opus[1m]')
  assert.equal(foreign.selectedReasoningEffort, 'high')
  const kept = claudeModelCatalog(infos, 'claude:claude-fable-5-1[1m]', 'max')
  assert.equal(kept.selectedReasoningEffort, 'max')
})

test('adaptive thinking follows the catalog entry, and the default entry for no model', () => {
  assert.equal(supportsAdaptiveThinking(infos, 'opus[1m]'), true)
  assert.equal(supportsAdaptiveThinking(infos, 'haiku'), false)
  assert.equal(supportsAdaptiveThinking(infos, null), true)
})

test('a saved id survives the CLI renaming its alias between launches', () => {
  // Yesterday's CLI listed Fable without the tier suffix; the pane saved that id.
  const renamed: ModelInfo[] = infos.map((info) => info.value === 'claude-fable-5-1[1m]'
    ? { ...info, value: 'claude-fable-5-1' } : info)
  assert.equal(resolveClaudeModelId(renamed, 'claude:claude-fable-5-1[1m]'), 'claude:claude-fable-5-1')
  assert.equal(claudeModelCatalog(renamed, 'claude:claude-fable-5-1[1m]', 'high').selectedModel, 'claude:claude-fable-5-1')
  // And the reverse: saved without the suffix, listed with it today.
  assert.equal(resolveClaudeModelId(infos, 'claude:claude-fable-5-1'), 'claude:claude-fable-5-1[1m]')
  assert.equal(claudeModelCatalog(infos, 'claude:claude-fable-5-1', 'high').selectedModel, 'claude:claude-fable-5-1[1m]')
  // Exact matches pass through; ids for models the CLI no longer lists resolve to nothing.
  assert.equal(resolveClaudeModelId(infos, 'claude:opus[1m]'), 'claude:opus[1m]')
  assert.equal(resolveClaudeModelId(infos, 'claude:sonnet'), null)
  assert.equal(resolveClaudeModelId(infos, 'gpt-5.6-sol'), null)
  assert.equal(claudeModelCatalog(infos, 'claude:sonnet', 'high').selectedModel, 'claude:opus[1m]')
})
