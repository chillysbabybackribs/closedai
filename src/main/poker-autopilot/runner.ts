import { unlink } from 'node:fs/promises'
import type { ToolRegistry } from '../tools/registry.js'
import type { ToolResult } from '../tools/tool.js'
import { installPokerAutopilotScript, SNAPSHOT_POKER_AUTOPILOT } from './inject-script.js'
import { actionTarget, decide, type TableSnapshot } from './strategy.js'
import { clearStop, shouldStop, statusFile, stopFile, writeStatus } from './status.js'
import { resolvePokerTab } from './tabs.js'

const POLL_MS = 250
const HERO = process.env.CLOSEDAI_POKER_HERO?.trim() || 'dirtyddann'

function textOf(result: ToolResult): string {
  return result.content[0]?.type === 'text' ? result.content[0].text ?? '' : ''
}

function parseJson(result: ToolResult): unknown {
  const text = textOf(result)
  if (result.isError) throw new Error(text || 'tool call failed')
  return JSON.parse(text)
}

function parseEvaluate(result: ToolResult): unknown {
  const parsed = parseJson(result) as { ok?: boolean; value?: unknown; error?: string }
  if (parsed.ok === false) throw new Error(String(parsed.error || 'evaluate failed'))
  return parsed.value ?? parsed
}

type RunnerOptions = {
  registry: ToolRegistry
  userData: string
  tabId?: string | null
  durationMs?: number
}

export async function runPokerAutopilot(options: RunnerOptions): Promise<Record<string, unknown>> {
  const { registry, userData } = options
  const durationMs = options.durationMs ?? Number(process.env.CLOSEDAI_POKER_AUTOPILOT_MS ?? 4 * 60 * 60_000)
  const tabId = await resolvePokerTab(userData, options.tabId ?? process.env.CLOSEDAI_POKER_TAB)
  if (!tabId) throw new Error('No BetOnline desktoppoker tab found. Open a table first.')

  await clearStop(userData)
  let status = await writeStatus(userData, {
    running: true,
    tabId,
    startedAt: new Date().toISOString(),
    lastError: null
  })

  const context = {
    paneId: 'poker-autopilot',
    threadId: null,
    turnId: null,
    callId: 'poker-autopilot',
    source: 'system' as const,
    signal: AbortSignal.timeout(durationMs)
  }

  const install = await registry.call({
    namespace: 'embedded_browser',
    tool: 'script',
    arguments: { action: 'evaluate', tab_id: tabId, expression: installPokerAutopilotScript(HERO), max_chars: 12_000 }
  }, context)
  parseEvaluate(install)

  const deadline = Date.now() + durationMs
  let lastClickAt = 0

  while (Date.now() < deadline && !context.signal.aborted) {
    if (await shouldStop(userData)) break

    const snapResult = await registry.call({
      namespace: 'embedded_browser',
      tool: 'script',
      arguments: { action: 'evaluate', tab_id: tabId, expression: SNAPSHOT_POKER_AUTOPILOT, max_chars: 12_000 }
    }, context)
    const snapshot = parseEvaluate(snapResult) as TableSnapshot & { error?: string; title?: string }
    if (snapshot.error) throw new Error(String(snapshot.error))

    status = await writeStatus(userData, {
      running: true,
      tabId,
      polls: status.polls + 1,
      lastHandId: snapshot.handId ?? status.lastHandId,
      heroStack: snapshot.stack == null ? status.heroStack : String(snapshot.stack)
    })

    const decision = decide(snapshot)
    if (decision && Date.now() - lastClickAt > 900) {
      const target = actionTarget(snapshot, decision)
      if (target) {
        const click = await registry.call({
          namespace: 'tool_batch',
          tool: 'run',
          arguments: {
            calls: [{
              tool: 'browser_cdp.page',
              arguments: {
                action: 'click_at',
                tab_id: tabId,
                x: target.x,
                y: target.y,
                coordinate_space: 'main_viewport_css',
                fallback_reason: `Poker autopilot: ${decision.reason}`
              }
            }]
          }
        }, { ...context, source: 'batch', callId: 'poker-autopilot-click' })
        if (click.isError) {
          status = await writeStatus(userData, { lastError: textOf(click), lastDecision: decision.reason })
        } else {
          lastClickAt = Date.now()
          status = await writeStatus(userData, {
            clicks: status.clicks + 1,
            lastDecision: `${decision.action}: ${decision.reason}`,
            lastError: null
          })
          console.log('[poker-autopilot]', decision.action, decision.reason, `@ ${target.x},${target.y}`)
        }
      }
    }

    await sleep(POLL_MS)
  }

  status = await writeStatus(userData, { running: false })
  try { await unlink(stopFile(userData)) } catch { /* already gone */ }
  return { ok: true, tabId, polls: status.polls, clicks: status.clicks, statusPath: statusFile(userData) }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
