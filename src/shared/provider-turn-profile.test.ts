import assert from 'node:assert/strict'
import test from 'node:test'
import { providerTurnProfile } from './provider-turn-profile.ts'

test('providerTurnProfile keeps Cursor on the thin harness', () => {
  assert.deepEqual(providerTurnProfile('cursor'), {
    sessionGuide: false,
    workspaceLedger: false,
    researchRouting: true,
    toolCatalogAttach: 'full_mcp'
  })
})

test('providerTurnProfile enables guide and ledger on the other lanes', () => {
  for (const provider of ['codex', 'claude', 'antigravity'] as const) {
    assert.deepEqual(providerTurnProfile(provider), {
      sessionGuide: true,
      workspaceLedger: true,
      researchRouting: true,
      toolCatalogAttach: 'task_slice'
    })
  }
})

test('Cursor baseline removes extra context on other providers without changing Cursor', () => {
  for (const provider of ['codex', 'claude', 'antigravity'] as const) {
    const profile = providerTurnProfile(provider, { chatCursorBaselineEnabled: true })
    assert.equal(profile.sessionGuide, false)
    assert.equal(profile.workspaceLedger, false)
    assert.equal(profile.researchRouting, true)
    assert.equal(profile.toolCatalogAttach, 'native_discovery')
    assert.equal(providerTurnProfile(provider, { chatCursorBaselineEnabled: false }).sessionGuide, true)
  }
  assert.deepEqual(providerTurnProfile('cursor', { chatCursorBaselineEnabled: true }), providerTurnProfile('cursor'))
})
