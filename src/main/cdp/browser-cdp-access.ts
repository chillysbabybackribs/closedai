import type { WebContents } from 'electron'
import type { BrowserTabInfo } from '../../shared/types.js'
import type { CdpToolHost } from '../tools/cdp/host.js'
import { CdpPageAgent } from './agent-page/page-agent.js'
import { CdpSession, type CdpEventPage } from './cdp-session.js'

export type CdpBrowserSource = {
  tabList(): BrowserTabInfo[]
  contentsOf(tabId?: string): WebContents | null
}

/** Resolves stable ClosedAI tab ids into transient CDP attachments. */
export class BrowserCdpAccess implements CdpToolHost {
  private readonly connections = new Map<string, { session: CdpSession; page: CdpPageAgent }>()

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
    return { tab, connectionId: session.connectionId, target, discovered }
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
    tab: BrowserTabInfo
  } {
    const { tab, session } = this.resolve(tabId)
    return { tab, ...session.eventPage(afterCursor, limit, methodPrefix) }
  }

  async inspectPage(tabId: string | undefined, maxElements: number): Promise<unknown> {
    const { tab, session, page } = this.resolve(tabId)
    return { tab, connectionId: session.connectionId, ...await page.inspect(maxElements) }
  }

  async clickElement(tabId: string | undefined, ref: string): Promise<unknown> {
    const { tab, session, page } = this.resolve(tabId)
    return { tab, connectionId: session.connectionId, ...await page.click(ref) }
  }

  async clickAt(tabId: string | undefined, x: number, y: number): Promise<unknown> {
    const { tab, session, page } = this.resolve(tabId)
    return { tab, connectionId: session.connectionId, ...await page.clickAt({ x, y }) }
  }

  dispose(): void {
    for (const connection of this.connections.values()) connection.session.dispose()
    this.connections.clear()
  }

  private resolve(tabId?: string): { tab: BrowserTabInfo; session: CdpSession; page: CdpPageAgent } {
    const browser = this.browser()
    if (!browser) throw new Error('The browser is not available yet')
    const tabs = browser.tabList()
    const tab = tabId ? tabs.find((candidate) => candidate.id === tabId) : tabs.find((candidate) => candidate.active)
    if (!tab) throw new Error(tabId ? `Browser tab ${tabId} does not exist` : 'There is no active browser tab')
    const contents = browser.contentsOf(tab.id)
    if (!contents) throw new Error(`Browser tab ${tab.id} is closed`)

    const current = this.connections.get(tab.id)
    if (current?.session.contentsId === contents.id) return { tab, ...current }
    current?.session.dispose()
    const session = new CdpSession(tab.id, contents, (closed) => {
      if (this.connections.get(tab.id)?.session === closed) this.connections.delete(tab.id)
    })
    const page = new CdpPageAgent(session)
    this.connections.set(tab.id, { session, page })
    return { tab, session, page }
  }
}
