/**
 * Stress limits for store cap, JSON cap, freshness storms, and gate edges (pilot-only).
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildWorkspaceLedgerAdditionalContext,
  createWorkspaceLedgerStore,
  MAX_LEDGER_ENTRIES,
  MAX_LEDGER_JSON_CHARS,
  needsWorkspaceContext,
  recordWorkspaceLedgerEntry,
  WORKSPACE_LEDGER_CONTEXT
} from './index.ts'

const ts = '2026-09-30T00:00:00.000Z'
const hash = 'abcd1234abcd1234'

function entry(path: string, overrides: Partial<{ contentHash: string; evidence: string }> = {}) {
  return {
    path,
    contentHash: overrides.contentHash ?? hash,
    role: 'read' as const,
    evidence: overrides.evidence,
    recordedAt: ts
  }
}

test('recordWorkspaceLedgerEntry caps at MAX_LEDGER_ENTRIES and drops oldest', () => {
  const store = createWorkspaceLedgerStore()
  for (let i = 0; i < 25; i++) {
    recordWorkspaceLedgerEntry(store, entry(`src/ledger-stress/file-${String(i).padStart(2, '0')}.ts`))
  }
  assert.equal(store.entries.length, MAX_LEDGER_ENTRIES)
  assert.equal(store.entries[0]!.path, 'src/ledger-stress/file-24.ts')
  assert.ok(!store.entries.some((e) => e.path === 'src/ledger-stress/file-00.ts'))
  assert.ok(!store.entries.some((e) => e.path === 'src/ledger-stress/file-04.ts'))
  assert.ok(store.entries.some((e) => e.path === 'src/ledger-stress/file-05.ts'))
})

test('recordWorkspaceLedgerEntry replaces same path and moves it to the front', () => {
  const store = createWorkspaceLedgerStore()
  const path = 'src/ledger-stress/replace-me.ts'
  recordWorkspaceLedgerEntry(store, entry(path, { contentHash: '1111111111111111' }))
  for (let i = 0; i < MAX_LEDGER_ENTRIES; i++) {
    recordWorkspaceLedgerEntry(store, entry(`src/ledger-stress/other-${i}.ts`))
  }
  recordWorkspaceLedgerEntry(store, entry(path, { contentHash: '2222222222222222' }))
  assert.equal(store.entries[0]!.path, path)
  assert.equal(store.entries[0]!.contentHash, '2222222222222222')
  assert.equal(store.entries.length, MAX_LEDGER_ENTRIES)
})

test('path hints are prioritized ahead of unrelated ledger rows', async () => {
  const store = createWorkspaceLedgerStore()
  for (let i = 0; i < MAX_LEDGER_ENTRIES; i++) {
    const id = String(i).padStart(2, '0')
    recordWorkspaceLedgerEntry(store, entry(`src/ledger-stress/priority-${id}.ts`))
  }
  const hintA = 'src/ledger-stress/priority-05.ts'
  const hintB = 'src/ledger-stress/priority-11.ts'
  const hintC = 'src/ledger-stress/priority-18.ts'
  const prompt = `Refactor ${hintA} and ${hintB} then check ${hintC}`
  const context = await buildWorkspaceLedgerAdditionalContext({
    prompt,
    store,
    readHash: async () => hash
  })
  assert.ok(context)
  const payload = JSON.parse(context![WORKSPACE_LEDGER_CONTEXT]!.value)
  const freshPaths = payload.fresh.map((row: { path: string }) => row.path)
  const hintSet = new Set([hintA, hintB, hintC])
  assert.deepEqual(freshPaths.slice(0, 3), [hintC, hintB, hintA])
  assert.ok(freshPaths.slice(3, 6).every((path: string) => !hintSet.has(path)))
})

test('all hash-mismatch rows still attach with stale partition on coding cue', async () => {
  const store = createWorkspaceLedgerStore()
  for (let i = 0; i < MAX_LEDGER_ENTRIES; i++) {
    recordWorkspaceLedgerEntry(store, entry(`src/ledger-stress/stale-${i}.ts`))
  }
  const context = await buildWorkspaceLedgerAdditionalContext({
    prompt: 'Debug the stale ledger module in this repo',
    store,
    readHash: async () => '0000000000000000'
  })
  assert.ok(context)
  const value = context![WORKSPACE_LEDGER_CONTEXT]!.value
  assert.ok(value.length <= MAX_LEDGER_JSON_CHARS)
  const payload = JSON.parse(value)
  assert.equal(payload.fresh.length, 0)
  assert.ok(payload.stale.length > 0)
  assert.ok(payload.stale.every((row: { reason: string }) => row.reason === 'hash-mismatch'))
})

test('all missing files still attach with stale reason missing', async () => {
  const store = createWorkspaceLedgerStore()
  for (let i = 0; i < MAX_LEDGER_ENTRIES; i++) {
    recordWorkspaceLedgerEntry(store, entry(`src/ledger-stress/missing-${i}.ts`))
  }
  const context = await buildWorkspaceLedgerAdditionalContext({
    prompt: 'Continue the missing-file handoff',
    store,
    readHash: async () => null
  })
  assert.ok(context)
  const payload = JSON.parse(context![WORKSPACE_LEDGER_CONTEXT]!.value)
  assert.equal(payload.fresh.length, 0)
  assert.ok(payload.stale.length > 0)
  assert.ok(payload.stale.every((row: { reason: string }) => row.reason === 'missing'))
})

test('gate handles long prompts and mixed browser/code phrasing', () => {
  const padding = 'word '.repeat(2_000)
  assert.equal(needsWorkspaceContext(`${padding} please refactor the settings store`), true)
  assert.equal(needsWorkspaceContext('Fix the tab order in src/components/ui/tabs.tsx'), true)
  assert.equal(needsWorkspaceContext('Fix the browser tab'), false)
  assert.equal(needsWorkspaceContext(''), false)
  assert.equal(needsWorkspaceContext('   '), false)
})

test('trimmed payload remains valid JSON at char cap under path and evidence pressure', async () => {
  const store = createWorkspaceLedgerStore()
  const longSegment = 'x'.repeat(80)
  for (let i = 0; i < MAX_LEDGER_ENTRIES; i++) {
    recordWorkspaceLedgerEntry(
      store,
      entry(`src/ledger-stress/${longSegment}/deep/file-${i}.ts`, {
        evidence: 'evidence-'.repeat(40)
      })
    )
  }
  const context = await buildWorkspaceLedgerAdditionalContext({
    prompt: `Implement src/ledger-stress/${longSegment}/deep/file-0.ts`,
    store,
    readHash: async () => hash
  })
  assert.ok(context)
  const value = context![WORKSPACE_LEDGER_CONTEXT]!.value
  assert.ok(value.length <= MAX_LEDGER_JSON_CHARS, `length ${value.length}`)
  assert.doesNotThrow(() => JSON.parse(value))
})

test('many path hints in one prompt stay bounded and parseable', async () => {
  const store = createWorkspaceLedgerStore()
  const paths: string[] = []
  for (let i = 0; i < 12; i++) {
    const path = `src/ledger-stress/hint-${i}.ts`
    paths.push(path)
    recordWorkspaceLedgerEntry(store, entry(path))
  }
  const prompt = `Review ${paths.join(' ')}`
  const context = await buildWorkspaceLedgerAdditionalContext({
    prompt,
    store,
    readHash: async () => hash
  })
  assert.ok(context)
  const payload = JSON.parse(context![WORKSPACE_LEDGER_CONTEXT]!.value)
  assert.equal(payload.pathHints.length, 12)
  assert.ok(context![WORKSPACE_LEDGER_CONTEXT]!.value.length <= MAX_LEDGER_JSON_CHARS)
})
