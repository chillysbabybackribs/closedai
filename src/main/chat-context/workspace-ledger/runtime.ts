import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { activityPhase, type ChatTranscriptItem } from '../../../shared/chat.js'
import type { AppSettings } from '../../../shared/types.js'
import type { AdditionalContext } from '../turn-context.js'
import {
  buildWorkspaceLedgerAdditionalContext,
  createWorkspaceLedgerStore,
  recordWorkspaceLedgerEntry,
  type WorkspaceLedgerStore
} from '../workspace-ledger-pilot/index.ts'
import { normalizeRepoPath, readWorkspaceFileHash } from './hash.ts'

const execFileAsync = promisify(execFile)

const stores = new Map<string, WorkspaceLedgerStore>()
const gitHeadCache = new Map<string, { head: string | null; at: number }>()
const GIT_HEAD_TTL_MS = 5_000

export function getWorkspaceLedgerStore(cwd: string): WorkspaceLedgerStore {
  let store = stores.get(cwd)
  if (!store) {
    store = createWorkspaceLedgerStore()
    stores.set(cwd, store)
  }
  return store
}

/** Test-only reset for in-memory project ledgers. */
export function resetWorkspaceLedgerStoresForTests(): void {
  stores.clear()
  gitHeadCache.clear()
}

async function readGitHead(cwd: string): Promise<string | null> {
  const cached = gitHeadCache.get(cwd)
  const now = Date.now()
  if (cached && now - cached.at < GIT_HEAD_TTL_MS) return cached.head
  let head: string | null = null
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, 'rev-parse', 'HEAD'], {
      timeout: 2_000,
      maxBuffer: 128
    })
    head = stdout.trim().slice(0, 12) || null
  } catch {
    head = null
  }
  gitHeadCache.set(cwd, { head, at: now })
  return head
}

function extractVerifiedTestPath(command: string): string | null {
  const testOne = command.match(/\btest:one\b[^]*?--\s+(\S+\.test\.(?:ts|tsx))/)
  if (testOne?.[1]) return testOne[1]
  return null
}

async function recordLedgerPath(
  cwd: string,
  path: string,
  role: 'edited' | 'verified-test',
  evidence: string
): Promise<void> {
  const rel = normalizeRepoPath(cwd, path)
  if (!rel) return
  const contentHash = await readWorkspaceFileHash(cwd, rel)
  if (!contentHash) return
  const gitHead = await readGitHead(cwd)
  recordWorkspaceLedgerEntry(getWorkspaceLedgerStore(cwd), {
    path: rel,
    contentHash,
    gitHead,
    role,
    evidence,
    recordedAt: new Date().toISOString()
  })
}

function settledDone(item: ChatTranscriptItem): boolean {
  if (item.type !== 'command' && item.type !== 'fileChange') return false
  return activityPhase(item.status, item.type === 'command' ? item.exitCode : null) === 'done'
}

function wasSettledDone(item: ChatTranscriptItem | undefined): boolean {
  if (!item) return false
  return settledDone(item)
}

/** Host hook: populate the project ledger from completed transcript activities. */
export async function observeWorkspaceLedgerTranscriptItem(
  cwd: string,
  previous: ChatTranscriptItem | undefined,
  item: ChatTranscriptItem
): Promise<void> {
  if (!settledDone(item) || wasSettledDone(previous)) return
  if (item.type === 'fileChange') {
    await Promise.all(
      item.changes.map((change) => recordLedgerPath(cwd, change.path, 'edited', `fileChange:${item.id}`))
    )
    return
  }
  if (item.type === 'command') {
    const command = `${item.command} ${item.output?.slice(0, 200) ?? ''}`
    if (!/\b(?:test:one|typecheck)\b/.test(command)) return
    const testPath = extractVerifiedTestPath(command)
    if (testPath) await recordLedgerPath(cwd, testPath, 'verified-test', `command:${item.id}`)
  }
}

export async function workspaceLedgerContextForTurn(input: {
  settings: Pick<AppSettings, 'chatWorkspaceLedgerEnabled'>
  prompt: string
  cwd: string
}): Promise<AdditionalContext | undefined> {
  if (input.settings.chatWorkspaceLedgerEnabled === false) return undefined
  return buildWorkspaceLedgerAdditionalContext({
    prompt: input.prompt,
    store: getWorkspaceLedgerStore(input.cwd),
    gitHead: await readGitHead(input.cwd),
    readHash: (path) => readWorkspaceFileHash(input.cwd, path)
  })
}
