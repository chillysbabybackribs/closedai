import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatModel } from './chat.js'
import { applyModelSwitch, buildModelManifest, filterPickerModels } from './model-settings.js'

const sample = (id: string): ChatModel => ({
  provider: 'codex',
  id,
  displayName: id,
  description: '',
  defaultReasoningEffort: 'high',
  supportedReasoningEfforts: [],
  isDefault: false
})

test('filterPickerModels hides disabled ids but keeps the active selection visible', () => {
  const models = [sample('a'), sample('b'), sample('c')]
  assert.deepEqual(filterPickerModels(models, ['b'], []), [sample('a'), sample('c')])
  assert.deepEqual(filterPickerModels(models, ['b'], ['b']), [sample('a'), sample('b'), sample('c')])
})

test('applyModelSwitch toggles membership in the disabled list', () => {
  assert.deepEqual(applyModelSwitch(['a'], 'b', false), ['a', 'b'])
  assert.deepEqual(applyModelSwitch(['a', 'b'], 'a', true), ['b'])
})

test('buildModelManifest counts enabled rows for connected providers', () => {
  const manifest = buildModelManifest([{
    provider: 'codex',
    label: 'Codex',
    connection: { state: 'ready', message: 'Ready' },
    installed: true,
    models: [sample('a'), sample('b')]
  }], ['b'])
  assert.equal(manifest.enabledCount, 1)
  assert.equal(manifest.totalCount, 2)
  assert.equal(manifest.providers[0]!.models.find((row) => row.model.id === 'b')?.enabled, false)
})
