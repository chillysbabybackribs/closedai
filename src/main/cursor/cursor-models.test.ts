import assert from 'node:assert/strict'
import test from 'node:test'
import { cursorModelId, cursorSessionIdOf, cursorThreadId, isCursorId } from './cursor-ids.ts'
import { cursorAcpModelId, cursorModelCatalog, cursorModelsFromAcp, describeCursorModel, parseCursorModelId } from './cursor-models.ts'

// Shapes taken verbatim from a live `session/new` (cursor-agent 2026.09.02-c22c1a3).
const ACP_MODELS = [
  { modelId: 'default[]', name: 'Auto' },
  { modelId: 'claude-opus-5[thinking=true,context=300k,effort=high,fast=false]', name: 'claude-opus-5' },
  { modelId: 'gpt-5.6-sol[context=272k,reasoning=medium,fast=false]', name: 'gpt-5.6-sol' },
  { modelId: 'composer-2.5[fast=true]', name: 'composer-2.5' }
]

test('ids round-trip through the cursor prefix and reject foreign ids', () => {
  assert.equal(cursorModelId('claude-opus-5[effort=high]'), 'cursor:claude-opus-5[effort=high]')
  assert.equal(cursorSessionIdOf(cursorThreadId('abc')), 'abc')
  assert.ok(isCursorId('cursor:abc'))
  assert.equal(isCursorId('agy:abc'), false)
  assert.equal(isCursorId('cursor:'), false)
  assert.equal(cursorSessionIdOf('claude:abc'), null)
})

test('a model id splits into its base and bracketed parameters', () => {
  assert.deepEqual(parseCursorModelId('claude-opus-5[thinking=true,context=300k,effort=high,fast=false]'), {
    base: 'claude-opus-5',
    params: { thinking: 'true', context: '300k', effort: 'high', fast: 'false' }
  })
  assert.deepEqual(parseCursorModelId('default[]'), { base: 'default', params: {} })
  assert.deepEqual(parseCursorModelId('bare-model'), { base: 'bare-model', params: {} })
})

test('the bracket becomes the description, covering both effort keys', () => {
  assert.match(describeCursorModel({ thinking: 'true', effort: 'high', context: '300k' }), /Thinking · high effort · 300k context/)
  assert.match(describeCursorModel({ reasoning: 'medium' }), /medium effort/)
  assert.equal(describeCursorModel({}), 'On your Cursor subscription')
})

test('the catalog is one entry per listed model and offers no effort ladder', () => {
  const models = cursorModelsFromAcp(ACP_MODELS, 'gpt-5.6-sol[context=272k,reasoning=medium,fast=false]')
  assert.equal(models.length, 4)
  assert.deepEqual(models.map((model) => model.displayName), ['Auto', 'claude-opus-5', 'gpt-5.6-sol', 'composer-2.5'])
  // `session/set_model` only accepts a listed id, so an id must round-trip verbatim.
  assert.equal(cursorAcpModelId(models[1]!.id), ACP_MODELS[1]!.modelId)
  // Effort is baked into each id, so offering a ladder would build ids the agent rejects.
  assert.deepEqual(models.flatMap((model) => model.supportedReasoningEfforts), [])
  assert.deepEqual(models.filter((model) => model.isDefault).map((model) => model.displayName), ['gpt-5.6-sol'])
})

test('the catalog falls back to the first model when the agent names no current one', () => {
  const catalog = cursorModelCatalog(ACP_MODELS, null, null)
  assert.equal(catalog.selectedModel, cursorModelId('default[]'))
  assert.equal(catalog.selectedReasoningEffort, null)
})

test('a saved preference is kept when the agent still lists it', () => {
  const saved = cursorModelId('composer-2.5[fast=true]')
  assert.equal(cursorModelCatalog(ACP_MODELS, 'default[]', saved, null).selectedModel, saved)
  assert.equal(cursorModelCatalog(ACP_MODELS, 'default[]', cursorModelId('gone[]'), null).selectedModel, cursorModelId('default[]'))
})
