import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { WORKSPACE_LEDGER_CONTEXT } from '../workspace-ledger-pilot/constants.ts'
import { shortContentHash } from './hash.ts'
import {
  getWorkspaceLedgerStore,
  observeWorkspaceLedgerTranscriptItem,
  resetWorkspaceLedgerStoresForTests,
  workspaceLedgerContextForTurn
} from './runtime.ts'

test('observeWorkspaceLedgerTranscriptItem records completed file changes', async () => {
  resetWorkspaceLedgerStoresForTests()
  const cwd = await mkdtemp(join(tmpdir(), 'closedai-ledger-wire-'))
  const rel = 'src/widget.ts'
  await mkdir(join(cwd, 'src'), { recursive: true })
  await writeFile(join(cwd, rel), 'hello', 'utf8')
  const hash = shortContentHash('hello')
  await observeWorkspaceLedgerTranscriptItem(cwd, undefined, {
    type: 'fileChange',
    id: 'f1',
    turnId: 't1',
    status: 'completed',
    changes: [{ path: rel, kind: 'update', diff: '+++' }]
  })
  const context = await workspaceLedgerContextForTurn({
    settings: { chatWorkspaceLedgerEnabled: true },
    prompt: 'Fix src/widget.ts',
    cwd
  })
  assert.ok(context)
  const payload = JSON.parse(context![WORKSPACE_LEDGER_CONTEXT]!.value)
  assert.equal(payload.fresh.length, 1)
  assert.equal(payload.fresh[0]!.path, rel)
  assert.equal(payload.fresh[0]!.contentHash, hash)
})

test('workspaceLedgerContextForTurn respects chatWorkspaceLedgerEnabled', async () => {
  resetWorkspaceLedgerStoresForTests()
  const cwd = await mkdtemp(join(tmpdir(), 'closedai-ledger-wire-'))
  getWorkspaceLedgerStore(cwd)
  const off = await workspaceLedgerContextForTurn({
    settings: { chatWorkspaceLedgerEnabled: false },
    prompt: 'Refactor src/foo.ts',
    cwd
  })
  assert.equal(off, undefined)
})
