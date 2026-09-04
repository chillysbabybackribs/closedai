import type { BrowserService } from './browser-service.js'
import { fetchInPage, type PageFetchRequest, type PageFetchResult } from './browser-page-fetch.js'
import { needsReadinessPoll, probePageReady, readPageText, waitForPageReady, type PageReadiness, type PageReadyResult, type PageText } from './browser-page-ready.js'
import { evaluateInPage, queryInPage, type PageEvaluateRequest, type PageEvaluateResult, type PageQueryRequest, type PageQueryResult } from './browser-page-evaluate.js'
import type { ConsoleFilter, ConsoleListing } from './browser-network/console-log.js'
import type { BrowserTabInfo } from '../shared/types.js'
import type { BrowserToolHost, NavigateOutcome } from './tools/browser/index.js'

/** BrowserToolHost over the live BrowserService: what the browser tool may do to real tabs. */
export class BrowserPageAccess implements BrowserToolHost {
  constructor(private readonly browser: () => BrowserService | null) {}

  listTabs(): BrowserTabInfo[] {
    return this.browser()?.tabList() ?? []
  }

  async readPage(
    tabId: string | undefined,
    options: { selector?: string; maxChars: number; raw?: boolean }
  ): Promise<PageText | null> {
    const contents = this.browser()?.contentsOf(tabId)
    if (!contents) return null
    return readPageText(contents, options)
  }

  async fetchPage(tabId: string | undefined, request: PageFetchRequest): Promise<PageFetchResult | null> {
    const contents = this.browser()?.contentsOf(tabId)
    if (!contents) return null
    return fetchInPage(contents, request)
  }

  async navigate(
    url: string,
    options: { tabId?: string; newTab: boolean; ready: PageReadiness }
  ): Promise<NavigateOutcome> {
    const service = this.browser()
    if (!service) return { ok: false, error: 'The browser is not available yet' }
    let tabId: string
    try {
      tabId = await service.navigateTab(url, options.newTab, options.tabId)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    const contents = service.contentsOf(tabId)
    if (!contents) return { ok: false, error: 'The tab closed while loading' }
    const ready = needsReadinessPoll(options.ready)
      ? await waitForPageReady(contents, options.ready)
      : await probePageReady(contents, options.ready)
    return { ok: true, tabId, ready }
  }

  async waitFor(tabId: string | undefined, ready: PageReadiness): Promise<PageReadyResult | null> {
    const contents = this.browser()?.contentsOf(tabId)
    if (!contents) return null
    return waitForPageReady(contents, ready)
  }

  async evaluate(tabId: string | undefined, request: PageEvaluateRequest): Promise<PageEvaluateResult | null> {
    const contents = this.browser()?.contentsOf(tabId)
    if (!contents) return null
    return evaluateInPage(contents, request)
  }

  async query(tabId: string | undefined, request: PageQueryRequest): Promise<PageQueryResult | null> {
    const contents = this.browser()?.contentsOf(tabId)
    if (!contents) return null
    return queryInPage(contents, request)
  }

  consoleMessages(tabId: string | undefined, filter: Omit<ConsoleFilter, 'tabId'>): ConsoleListing | null {
    const service = this.browser()
    const contents = service?.contentsOf(tabId)
    if (!service || !contents) return null
    const resolved = service.tabIdForContents(contents.id)
    if (!resolved) return null
    return service.observers.console.list({ ...filter, tabId: resolved })
  }
}
