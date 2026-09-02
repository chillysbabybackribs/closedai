import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import { claudeModelId, claudeModelValue, claudeSessionIdOf, claudeThreadId, isClaudeModelId, isClaudeThreadId } from './claude-ids.js'
import { claudeModelCatalog, claudeModelsFromInfo, supportsAdaptiveThinking } from './claude-models.js'

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

test('catalog collapses aliases, keeps the CLI default, and carries effort levels', () => {
  const models = claudeModelsFromInfo(infos)
  assert.deepEqual(models.map((model) => model.id), ['claude:opus[1m]', 'claude:claude-fable-5-1[1m]', 'claude:haiku'])
  assert.equal(models[0]!.isDefault, true)
  assert.equal(models[0]!.provider, 'claude')
  assert.equal(models[0]!.defaultReasoningEffort, 'high')
  assert.deepEqual(models[0]!.supportedReasoningEfforts.map((option) => option.reasoningEffort), ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(models[2]!.supportedReasoningEfforts, [])
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
