/**
 * Workspace ledger pilot — isolated from `npm test` (see package.json test:pilot:workspace-ledger).
 * Not wired into buildTurnSendContext until promoted.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  buildWorkspaceLedgerAdditionalContext,
  createWorkspaceLedgerStore,
  extractPathHints,
  needsWorkspaceContext,
  recordWorkspaceLedgerEntry,
  WORKSPACE_LEDGER_CONTEXT
} from './index.ts'

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

test('needsWorkspaceContext mirrors coding and audit cues without browser-only prompts', () => {
  assert.equal(needsWorkspaceContext('Refactor the settings store'), true)
  assert.equal(needsWorkspaceContext('Read-only: assess the message scroller helper in this repo'), true)
  assert.equal(needsWorkspaceContext('What is the weather in Boston?'), false)
  assert.equal(needsWorkspaceContext('Open this link in a new tab'), false)
})

test('extractPathHints collects repo-relative paths from the prompt', () => {
  assert.deepEqual(
    extractPathHints('Please fix src/components/ui/message-scroller-state.ts and docs/tools.md'),
    ['src/components/ui/message-scroller-state.ts', 'docs/tools.md']
  )
})

test('buildWorkspaceLedgerAdditionalContext skips unrelated turns', async () => {
  const store = createWorkspaceLedgerStore()
  recordWorkspaceLedgerEntry(store, {
    path: 'src/foo.ts',
    contentHash: 'abc',
    role: 'edited',
    recordedAt: '2026-09-30T00:00:00.000Z'
  })
  const context = await buildWorkspaceLedgerAdditionalContext({
    prompt: 'Tell me a joke',
    store,
    readHash: async () => 'abc'
  })
  assert.equal(context, undefined)
})

test('fresh and stale entries partition from host readHash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-ledger-pilot-'))
  const rel = 'src/widget.ts'
  const abs = join(dir, rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, 'v1', 'utf8')
  const hashV1 = contentHash('v1')
  const store = createWorkspaceLedgerStore()
  recordWorkspaceLedgerEntry(store, {
    path: rel,
    contentHash: hashV1,
    gitHead: 'deadbeef',
    role: 'read',
    evidence: 'read:turn-1',
    recordedAt: '2026-09-30T00:00:00.000Z'
  })
  const readHash = async (path: string) => {
    try {
      const bytes = await readFile(join(dir, path), 'utf8')
      return contentHash(bytes)
    } catch {
      return null
    }
  }
  const beforeEdit = await buildWorkspaceLedgerAdditionalContext({
    prompt: 'Fix src/widget.ts',
    store,
    gitHead: 'deadbeef',
    readHash,
    capturedAt: '2026-09-30T01:00:00.000Z'
  })
  assert.ok(beforeEdit)
  assert.equal(beforeEdit[WORKSPACE_LEDGER_CONTEXT]?.kind, 'untrusted')
  const payload = JSON.parse(beforeEdit[WORKSPACE_LEDGER_CONTEXT]!.value)
  assert.equal(payload.fresh.length, 1)
  assert.equal(payload.stale.length, 0)
  assert.deepEqual(payload.pathHints, ['src/widget.ts'])

  await writeFile(abs, 'v2', 'utf8')
  const afterEdit = await buildWorkspaceLedgerAdditionalContext({
    prompt: 'Continue the widget fix',
    store,
    readHash
  })
  const payload2 = JSON.parse(afterEdit![WORKSPACE_LEDGER_CONTEXT]!.value)
  assert.equal(payload2.fresh.length, 0)
  assert.deepEqual(payload2.stale, [{ path: rel, reason: 'hash-mismatch' }])
})
