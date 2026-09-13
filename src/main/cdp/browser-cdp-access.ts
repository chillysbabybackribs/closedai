import type { WebContents } from 'electron'
import type { BrowserTabInfo } from '../../shared/types.js'
import { describeMissingTab } from '../../shared/browser-tabs.js'
import { recordOf } from '../json-coerce.js'
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
import { dismissOverlayWithCdp } from './overlay/overlay-dismiss-cdp.js'
import {
  armHeapSampling,
  channelsFrom as profileChannelsFrom,
  foldMetrics,
  liveStyleSheets,
  startProfiling,
  stopProfiling,
  styleSheetIndex
} from './cdp-profile.js'
import {
  channelsFrom as instrumentChannelsFrom,
  foldRecording,
  installInstrument,
  RECORDING_EXPRESSION,
  REMOVE_EXPRESSION
} from './cdp-instrument.js'
import {
  applyEmulation,
  resetEmulation,
  type DeviceEmulationParameters,
  type EmulateRequest
} from './cdp-emulate.js'

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
  /** Resize a tab's native surface for viewport emulation; false when the tab is unknown. */
  setEmulatedViewport?(tabId: string, size: { width: number; height: number } | null): boolean
}

export type CdpBrowserTarget = BrowserTabInfo & {
  kind: 'tab' | 'popup'
  openerTabId?: string
}

type ResolvedTab = { tab: CdpBrowserTarget; session: CdpSession; page: CdpPageController; input: CdpPageInput }

/** Resolves stable ClosedAI tab ids into transient CDP attachments. */
export class BrowserCdpAccess implements CdpToolHost {
  private readonly connections = new Map<string, { session: CdpSession; page: CdpPageController; input: CdpPageInput }>()
  /** Channels armed by `profile start`, so `stop` folds exactly what was started. */
  private readonly profiling = new Map<
    string,
    { channels: ReturnType<typeof profileChannelsFrom>; stopWatch?: () => void }
  >()
  /** `Page.addScriptToEvaluateOnNewDocument` identifiers, so a hook can be removed again. */
  private readonly instruments = new Map<string, string>()

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
    const merged = mergeRequests(foldNetworkEvents(buffered.events), timing, filter)
    return {
      tab,
      connectionId: session.connectionId,
      capturing,
      bufferedEvents: buffered.events.length,
      missedEvents: buffered.missedEvents,
      timingEntries: timing.length,
      matched: merged.matched,
      returned: merged.requests.length,
      requests: merged.requests
    }
  }

  async responseBody(tabId: string | undefined, requestId: string, sessionId?: string): Promise<unknown> {
    const { tab, session } = this.resolve(tabId)
    const raw = await session.command('Network.getResponseBody', { requestId }, sessionId)
    const record = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const body = typeof record.body === 'string' ? record.body : ''
    return {
      tab,
      connectionId: session.connectionId,
      requestId,
      sessionId: sessionId ?? null,
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

  async dismissOverlay(tabId: string | undefined, kind?: string, verifyTimeoutMs?: number): Promise<unknown> {
    return this.realInput(tabId, ({ session }) => dismissOverlayWithCdp(
      (command, params) => session.command(command, params ?? {}),
      { kind: kind as 'auto' | 'modal' | 'dialog' | 'popover' | undefined, verifyTimeoutMs }
    ))
  }

  /**
   * Coverage and sampling are armed with `start`, exercised by whatever the caller does next,
   * and folded by `stop`. Taking a precise-coverage report raw is ~950k characters on a real
   * page, so the arithmetic happens here and only the summary crosses the tool boundary.
   */
  async profile(
    tabId: string | undefined,
    action: string,
    options: { channels: string[]; limit: number }
  ): Promise<unknown> {
    const { tab, session } = this.resolve(tabId)
    const send = (method: string, params?: Record<string, unknown>) => session.command(method, params ?? {})
    const head = { tab, connectionId: session.connectionId }
    if (action === 'metrics') {
      await send('Performance.enable')
      return { ...head, metrics: foldMetrics(await send('Performance.getMetrics')) }
    }
    const channels = profileChannelsFrom(options.channels)
    if (action === 'start') {
      const started = await startProfiling(send, channels)
      this.endProfileWatch(tab.id)
      this.profiling.set(tab.id, {
        channels,
        stopWatch: channels.heap ? this.watchForHeapRearm(session) : undefined
      })
      return { ...head, started, note: 'Exercise the page, then call stop.' }
    }
    const active = this.profiling.get(tab.id)?.channels ?? channels
    this.endProfileWatch(tab.id)
    const styleSheets = active.style
      ? await liveStyleSheets(send, styleSheetIndex(session.eventPage(0, EVENT_SCAN_LIMIT, 'CSS.').events))
      : []
    const report = await stopProfiling(send, active, { limit: options.limit, styleSheets })
    return { ...head, ...report }
  }

  /** Install, read, or remove the pre-document recorder. */
  async instrument(
    tabId: string | undefined,
    action: string,
    options: { channels: string[]; capacity: number; limit: number }
  ): Promise<unknown> {
    const { tab, session } = this.resolve(tabId)
    const send = (method: string, params?: Record<string, unknown>) => session.command(method, params ?? {})
    const head = { tab, connectionId: session.connectionId }
    if (action === 'hook') {
      const channels = instrumentChannelsFrom(options.channels)
      const installed = await installInstrument(send, channels, options.capacity)
      const previous = this.instruments.get(tab.id)
      if (previous) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: previous }).catch(() => undefined)
      if (installed.identifier) this.instruments.set(tab.id, installed.identifier)
      return { ...head, channels, capacity: options.capacity, ...installed }
    }
    if (action === 'recording') {
      const raw = await send('Runtime.evaluate', { expression: RECORDING_EXPRESSION, returnByValue: true })
      return { ...head, ...foldRecording(raw, { limit: options.limit }) }
    }
    const identifier = this.instruments.get(tab.id)
    if (identifier) {
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
      this.instruments.delete(tab.id)
    }
    const removed = await send('Runtime.evaluate', { expression: REMOVE_EXPRESSION, returnByValue: true })
    const value = (removed as { result?: { value?: unknown } } | null)?.result?.value
    return { ...head, removedFromFutureDocuments: Boolean(identifier), removedFromCurrentDocument: String(value ?? '') }
  }

  /**
   * Viewport emulation goes through Electron because CDP's screen metrics do not move the layout
   * viewport of a tab hosted in a WebContentsView; everything else is CDP. The result reports what
   * the page itself measured afterwards.
   */
  async emulate(tabId: string | undefined, request: EmulateRequest | null): Promise<unknown> {
    const { tab, session } = this.resolve(tabId)
    const send = (method: string, params?: Record<string, unknown>) => session.command(method, params ?? {})
    const browser = this.browser()
    const target = {
      enableDeviceEmulation: (parameters: DeviceEmulationParameters) => session.contents.enableDeviceEmulation(parameters),
      disableDeviceEmulation: () => session.contents.disableDeviceEmulation(),
      setEmulatedViewport: (size: { width: number; height: number } | null) => {
        browser?.setEmulatedViewport?.(tab.id, size)
      }
    }
    const outcome = request
      ? await applyEmulation(target, send, request)
      : await resetEmulation(target, send)
    return { tab, connectionId: session.connectionId, reset: request === null, ...outcome }
  }

  dispose(): void {
    for (const connection of this.connections.values()) connection.session.dispose()
    this.connections.clear()
    for (const armed of this.profiling.values()) armed.stopWatch?.()
    this.profiling.clear()
    this.instruments.clear()
  }

  /**
   * Re-arm heap sampling for each new main-frame document. V8 restores the profiler and coverage
   * agents into the new isolate itself but not the sampling heap profiler, so without this a
   * navigation between start and stop leaves `HeapProfiler.stopSampling` addressed at an isolate
   * that no longer exists — a command that never answers at all.
   */
  private watchForHeapRearm(session: CdpSession): () => void {
    return session.observe((method, params) => {
      if (method !== 'Page.frameNavigated') return
      const frame = recordOf(recordOf(params)?.frame)
      if (!frame || frame.parentId) return
      void armHeapSampling((command, sent) => session.command(command, sent ?? {})).catch(() => undefined)
    })
  }

  private endProfileWatch(tabId: string): void {
    this.profiling.get(tabId)?.stopWatch?.()
    this.profiling.delete(tabId)
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
    if (!tab) throw new Error(describeMissingTab(tabId, tabs))
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
