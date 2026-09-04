import type { WebContents } from 'electron'
import type { BrowserTabInfo } from '../../shared/types.js'
import type { CdpToolHost } from '../tools/cdp/host.js'
import { CdpPageController } from './page-control/page-controller.js'
import { CdpPageInput } from './page-control/page-input.js'
import { CdpSession, type CdpEventPage } from './cdp-session.js'
import {
  decodeResponseBody,
  foldNetworkEvents,
  mergeRequests,
  parseResourceTiming,
  RESOURCE_TIMING_EXPRESSION
} from './cdp-network.js'
import { settleFrames } from '../browser-frame-settle.js'

/** How much of the event buffer a request listing folds; the buffer itself holds 1,000. */
const EVENT_SCAN_LIMIT = 1_000

/** Unwrap `Runtime.evaluate`'s `{ result: { value } }` envelope. */
function evaluationValue(raw: unknown): unknown {
  const outer = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : null
  const inner = outer?.result !== null && typeof outer?.result === 'object'
    ? outer.result as Record<string, unknown>
    : null
  return inner?.value
}

export type CdpBrowserSource = {
  tabList(): BrowserTabInfo[]
  /** All browser-owned CDP roots; native popups are excluded from tabList(). */
  cdpTargetList?(): CdpBrowserTarget[]
  contentsOf(tabId?: string): WebContents | null
  /** Foreground a tab for real input; null when no tab can currently receive any. */
  focusTabForInput(tabId: string): { activated: boolean } | null
}

export type CdpBrowserTarget = BrowserTabInfo & {
  kind: 'tab' | 'popup'
  openerTabId?: string
}

type ResolvedTab = { tab: CdpBrowserTarget; session: CdpSession; page: CdpPageController; input: CdpPageInput }

/** Resolves stable ClosedAI tab ids into transient CDP attachments. */
export class BrowserCdpAccess implements CdpToolHost {
  private readonly connections = new Map<string, { session: CdpSession; page: CdpPageController; input: CdpPageInput }>()

  constructor(private readonly browser: () => CdpBrowserSource | null) {}

  async capabilities(tabId?: string): Promise<unknown> {
    const { tab, session } = this.resolve(tabId)
    const [browser, schema] = await Promise.all([
      session.command('Browser.getVersion'),
      session.command('Schema.getDomains')
    ])
    return { tab, connectionId: session.connectionId, browser, schema }
  }

  async targets(tabId?: string): Promise<unknown> {
    const { tab, session } = this.resolve(tabId)
    const target = await session.command('Target.getTargetInfo')
    const discovered = await session.command('Target.getTargets')
    const browser = this.browser()
    const roots = browser?.cdpTargetList?.() ?? browser?.tabList().map((candidate) => ({
      ...candidate,
      kind: 'tab' as const
    })) ?? []
    return { tab, connectionId: session.connectionId, target, discovered, inventory: session.targetInventory(), roots }
  }

  async command(
    tabId: string | undefined,
    method: string,
    params: Record<string, unknown>,
    sessionId?: string
  ): Promise<unknown> {
    const { tab, session } = this.resolve(tabId)
    const result = await session.command(method, params, sessionId)
    return { tab, connectionId: session.connectionId, method, sessionId: sessionId ?? null, result }
  }

  events(tabId: string | undefined, afterCursor: number, limit: number, methodPrefix?: string): CdpEventPage & {
    tab: CdpBrowserTarget
  } {
    const { tab, session } = this.resolve(tabId)
    return { tab, ...session.eventPage(afterCursor, limit, methodPrefix) }
  }

  /**
   * Enabling Network here is deliberate: the first call answers from resource timing, which is
   * retroactive, and switches on capture so the next call also has methods, statuses, and the
   * request ids that `responseBody` needs. Discovery costs one call instead of a reload.
   */
  async networkRequests(
    tabId: string | undefined,
    filter: { url?: string; type?: string; limit: number }
  ): Promise<unknown> {
    const { tab, session } = this.resolve(tabId)
    let capturing = true
    try {
      await session.command('Network.enable')
    } catch {
      capturing = false
    }
    const evaluated = await session.command('Runtime.evaluate', {
      expression: RESOURCE_TIMING_EXPRESSION,
      returnByValue: true
    })
    const timing = parseResourceTiming(evaluationValue(evaluated))
    const buffered = session.eventPage(0, EVENT_SCAN_LIMIT, 'Network.')
    const requests = mergeRequests(foldNetworkEvents(buffered.events), timing, filter)
    return {
      tab,
      connectionId: session.connectionId,
      capturing,
      bufferedEvents: buffered.events.length,
      missedEvents: buffered.missedEvents,
      timingEntries: timing.length,
      requests
    }
  }

  async responseBody(tabId: string | undefined, requestId: string): Promise<unknown> {
    const { tab, session } = this.resolve(tabId)
    const raw = await session.command('Network.getResponseBody', { requestId })
    const record = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const body = typeof record.body === 'string' ? record.body : ''
    return {
      tab,
      connectionId: session.connectionId,
      requestId,
      ...decodeResponseBody(body, record.base64Encoded === true)
    }
  }

  async inspectPage(tabId: string | undefined, maxElements: number): Promise<unknown> {
    const { tab, session, page } = this.resolve(tabId)
    return { tab, connectionId: session.connectionId, ...await page.inspect(maxElements) }
  }

  async clickElement(tabId: string | undefined, ref: string): Promise<unknown> {
    return this.realInput(tabId, ({ page }) => page.click(ref))
  }

  async clickAt(tabId: string | undefined, x: number, y: number): Promise<unknown> {
    return this.realInput(tabId, ({ page }) => page.clickAt({ x, y }))
  }

  async typeText(tabId: string | undefined, ref: string, text: string, clear: boolean): Promise<unknown> {
    return this.realInput(tabId, ({ input }) => input.type(ref, text, clear))
  }

  async pressKey(tabId: string | undefined, key: string, modifiers: string[]): Promise<unknown> {
    return this.realInput(tabId, ({ input }) => input.pressKey(key, modifiers))
  }

  async scrollPage(tabId: string | undefined, ref: string | undefined, deltaX: number, deltaY: number): Promise<unknown> {
    return this.realInput(tabId, ({ input }) => input.scroll(ref, deltaX, deltaY))
  }

  dispose(): void {
    for (const connection of this.connections.values()) connection.session.dispose()
    this.connections.clear()
  }

  /**
   * Run one real-input operation against a tab that is actually on screen.
   *
   * Trusted CDP input is delivered through the compositor, so dispatching it at a background tab
   * used to look like success while the page never saw the event (and a wheel never came back at
   * all). Foreground the tab first, let it paint, and refuse loudly when nothing can be focused.
   */
  private async realInput<T extends object>(
    tabId: string | undefined,
    run: (target: ResolvedTab) => Promise<T>
  ): Promise<unknown> {
    const resolved = this.resolve(tabId)
    const browser = this.browser()
    if (!browser) throw new Error('The browser is not available yet')
    const focus = browser.focusTabForInput(resolved.tab.id)
    if (!focus) {
      throw new Error(
        `Browser tab ${resolved.tab.id} cannot receive real input because the browser page is not ` +
        'on screen. Show the browser pane, or dismiss what covers it, and retry.'
      )
    }
    // Re-resolve after a switch so the echoed tab metadata describes the tab as it now is.
    const target = focus.activated ? this.resolve(resolved.tab.id) : resolved
    if (focus.activated) await settleFrames(target.session.contents)
    const result = await run(target)
    return {
      tab: target.tab,
      connectionId: target.session.connectionId,
      ...(focus.activated ? { activatedTab: true } : {}),
      ...result
    }
  }

  private resolve(tabId?: string): ResolvedTab {
    const browser = this.browser()
    if (!browser) throw new Error('The browser is not available yet')
    const tabs = browser.tabList()
    const tab = tabId
      ? (browser.cdpTargetList?.() ?? tabs.map((candidate) => ({ ...candidate, kind: 'tab' as const })))
        .find((candidate) => candidate.id === tabId)
      : tabs.find((candidate) => candidate.active) && { ...tabs.find((candidate) => candidate.active)!, kind: 'tab' as const }
    if (!tab) throw new Error(tabId ? `Browser tab ${tabId} does not exist` : 'There is no active browser tab')
    const contents = browser.contentsOf(tab.id)
    if (!contents) throw new Error(`Browser tab ${tab.id} is closed`)

    const current = this.connections.get(tab.id)
    if (current?.session.contentsId === contents.id) return { tab, ...current }
    current?.session.dispose()
    const session = new CdpSession(tab.id, contents, (closed) => {
      if (this.connections.get(tab.id)?.session === closed) this.connections.delete(tab.id)
    })
    const page = new CdpPageController(session)
    const input = new CdpPageInput(session, page)
    const connection = { session, page, input }
    this.connections.set(tab.id, connection)
    return { tab, ...connection }
  }
}
