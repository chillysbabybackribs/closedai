/**
 * Deterministic A/B harness for regex gate + ledger injection (no live model sends).
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  buildWorkspaceLedgerAdditionalContext,
  createWorkspaceLedgerStore,
  needsWorkspaceContext,
  recordWorkspaceLedgerEntry,
  WORKSPACE_LEDGER_CONTEXT
} from './index.ts'

type GateFixture = { id: string; prompt: string; attach: boolean }
type AbScenario = {
  id: string
  prompt: string
  paths: string[]
  expectFreshCount?: number
  expectStaleCount?: number
  expectContext?: boolean
}

type HarnessFixtures = {
  gateExpectations: GateFixture[]
  abScenarios: AbScenario[]
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

async function loadFixtures(): Promise<HarnessFixtures> {
  const raw = await readFile(
    join(repoRoot, 'harness/workspace-ledger-pilot/prompt-fixtures.json'),
    'utf8'
  )
  return JSON.parse(raw) as HarnessFixtures
}

async function repoReadHash(path: string): Promise<string | null> {
  try {
    const bytes = await readFile(join(repoRoot, path), 'utf8')
    return contentHash(bytes)
  } catch {
    return null
  }
}

test('A/B gate fixtures: attach only on repo-relevant prompts', async () => {
  const { gateExpectations } = await loadFixtures()
  const failures: string[] = []
  for (const fixture of gateExpectations) {
    const attach = needsWorkspaceContext(fixture.prompt)
    if (attach !== fixture.attach) {
      failures.push(`${fixture.id}: expected attach=${fixture.attach}, got ${attach}`)
    }
  }
  assert.equal(failures.length, 0, failures.join('\n'))
})

test('A/B injection fixtures: ledger on vs off and fresh path counts', async () => {
  const { abScenarios } = await loadFixtures()
  for (const scenario of abScenarios) {
    const store = createWorkspaceLedgerStore()
    for (const path of scenario.paths) {
      const hash = await repoReadHash(path)
      assert.ok(hash, `${scenario.id}: missing repo file ${path}`)
      recordWorkspaceLedgerEntry(store, {
        path,
        contentHash: hash,
        gitHead: 'pilot-ab',
        role: 'read',
        evidence: `fixture:${scenario.id}`,
        recordedAt: '2026-09-30T00:00:00.000Z'
      })
    }
    const context = await buildWorkspaceLedgerAdditionalContext({
      prompt: scenario.prompt,
      store,
      gitHead: 'pilot-ab',
      readHash: repoReadHash,
      capturedAt: '2026-09-30T02:00:00.000Z'
    })
    const expectContext = scenario.expectContext ?? true
    if (!expectContext) {
      assert.equal(context, undefined, scenario.id)
      continue
    }
    assert.ok(context, scenario.id)
    const payload = JSON.parse(context![WORKSPACE_LEDGER_CONTEXT]!.value)
    assert.equal(payload.fresh.length, scenario.expectFreshCount ?? 0, scenario.id)
    assert.equal(payload.stale.length, scenario.expectStaleCount ?? 0, scenario.id)
    assert.equal(payload.fresh.some((e: { path: string }) => e.path.includes('resizeScrollAction')), false)
    for (const entry of payload.fresh) {
      assert.match(entry.contentHash, /^[a-f0-9]{16}$/)
      assert.ok(entry.path.startsWith('src/'))
    }
  }
})

test('A/B summary: gate pass rate and injection attach rate', async () => {
  const fixtures = await loadFixtures()
  let gatePass = 0
  for (const fixture of fixtures.gateExpectations) {
    if (needsWorkspaceContext(fixture.prompt) === fixture.attach) gatePass++
  }
  let injectionPass = 0
  for (const scenario of fixtures.abScenarios) {
    const store = createWorkspaceLedgerStore()
    for (const path of scenario.paths) {
      const hash = await repoReadHash(path)
      if (!hash) continue
      recordWorkspaceLedgerEntry(store, {
        path,
        contentHash: hash,
        role: 'read',
        recordedAt: '2026-09-30T00:00:00.000Z'
      })
    }
    const context = await buildWorkspaceLedgerAdditionalContext({
      prompt: scenario.prompt,
      store,
      readHash: repoReadHash
    })
    const expectContext = scenario.expectContext ?? true
    const ok = expectContext ? context !== undefined : context === undefined
    if (ok) injectionPass++
  }
  assert.equal(gatePass, fixtures.gateExpectations.length)
  assert.equal(injectionPass, fixtures.abScenarios.length)
})
