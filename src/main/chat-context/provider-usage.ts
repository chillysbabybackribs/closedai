import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { ChatProvider, ProviderUsageSnapshot } from '../../shared/chat.js'
import { AppServerClient } from '../app-server-client.js'
import { codexExecutable } from '../codex-workspace-runtime.js'
import { normalizeAccount } from '../chat-normalizers.js'
import { loadClaudeSdk } from '../claude/claude-sdk.js'
import { ClaudeRuntime } from '../claude/claude-runtime.js'
import { claudeQueryOptions } from '../claude/claude-options.js'
import { readAntigravityPlanUsage, cachedAntigravityPlanUsage } from '../antigravity/antigravity-quota.js'
import { readCursorAbout, parseCursorAccountEmail, parseCursorPlan } from '../cursor/cursor-cli.js'
import { codexPlanUsage, planUsageUnavailable } from './plan-usage.js'

/** Account probes never create/resume a chat or send a model turn. */
async function probe(provider: ChatProvider): Promise<ProviderUsageSnapshot> {
  if (provider === 'antigravity') {
    const reading = await readAntigravityPlanUsage()
    return { provider, account: null, usage: typeof reading === 'string' ? cachedAntigravityPlanUsage() : reading }
  }
  if (provider === 'cursor') {
    const about = await readCursorAbout()
    if (!about.ok) throw new Error('Could not read Cursor account')
    const plan = parseCursorPlan(about.stdout)
    return { provider, account: { type: 'other', email: parseCursorAccountEmail(about.stdout), planType: plan },
      usage: { ...planUsageUnavailable('The Cursor CLI does not report subscription usage.'), plan } }
  }
  if (provider === 'codex') {
    const client = new AppServerClient(codexExecutable(), homedir())
    try {
      await client.start()
      const [account, limits] = await Promise.all([
        client.request<{ account: unknown }>('account/read', {}),
        client.request<{ rateLimits: unknown }>('account/rateLimits/read', {})
      ])
      return { provider, account: normalizeAccount(account.account), usage: codexPlanUsage(limits.rateLimits) }
    } finally { client.stop() }
  }
  const runtimeId = randomUUID()
  const runtime = new ClaudeRuntime(await loadClaudeSdk(), runtimeId, claudeQueryOptions({
    cwd: homedir(), model: null, effort: null, adaptiveThinking: false, resume: null, runtimeId, mcpServers: {}
  }), { onMessage: () => {}, onEnd: () => {} })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const [account, usage] = await Promise.race([
      Promise.all([runtime.accountInfo(), runtime.planUsage()]),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Claude usage read timed out')), 20_000) })
    ])
    return { provider, account: { type: 'claude', email: account.email ?? null, planType: account.subscriptionType ?? null }, usage }
  } finally {
    clearTimeout(timer)
    await runtime.close()
  }
}

/** Shared across renderer mounts/windows; failures are bounded and do not erase dated readings. */
export function createProviderUsageReader(read = probe, now = Date.now): (provider: ChatProvider) => Promise<ProviderUsageSnapshot> {
  const cache = new Map<ChatProvider, { at: number; result: ProviderUsageSnapshot }>()
  const pending = new Map<ChatProvider, Promise<ProviderUsageSnapshot>>()
  return (provider) => {
    const active = pending.get(provider)
    if (active) return active
    const prior = cache.get(provider)
    if (prior && now() - prior.at < 60_000) return Promise.resolve(prior.result)
    const request = read(provider).then((result) => {
      if (!result.usage) throw new Error('No provider reading available. Check CLI sign-in and retry.')
      return result
    }).catch((error: unknown): ProviderUsageSnapshot => prior?.result ?? {
      provider, account: null, usage: planUsageUnavailable(error instanceof Error ? error.message : 'Could not read provider usage', now())
    }).then((result) => {
      cache.set(provider, { at: now(), result })
      return result
    }).finally(() => pending.delete(provider))
    pending.set(provider, request)
    return request
  }
}

export const readProviderUsage = createProviderUsageReader()
