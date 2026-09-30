import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildWorkspaceLedgerAdditionalContext,
  createWorkspaceLedgerStore,
  MAX_LEDGER_JSON_CHARS,
  recordWorkspaceLedgerEntry,
  WORKSPACE_LEDGER_CONTEXT
} from './index.ts'

test('ledger JSON stays within MAX_LEDGER_JSON_CHARS when store is oversized', async () => {
  const store = createWorkspaceLedgerStore()
  for (let i = 0; i < 25; i++) {
    recordWorkspaceLedgerEntry(store, {
      path: `src/modules/feature-${i}/index.ts`,
      contentHash: 'a'.repeat(16),
      role: 'edited',
      evidence: 'x'.repeat(120),
      recordedAt: '2026-09-30T00:00:00.000Z'
    })
  }
  const context = await buildWorkspaceLedgerAdditionalContext({
    prompt: 'Refactor src/modules/feature-0/index.ts',
    store,
    readHash: async () => 'a'.repeat(16)
  })
  assert.ok(context)
  const value = context![WORKSPACE_LEDGER_CONTEXT]!.value
  assert.ok(value.length <= MAX_LEDGER_JSON_CHARS)
  assert.doesNotThrow(() => JSON.parse(value))
})
