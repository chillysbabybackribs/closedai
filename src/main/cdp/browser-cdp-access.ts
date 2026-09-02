import type { WebContents } from 'electron'
import type { BrowserTabInfo } from '../../shared/types.js'
import type { CdpToolHost } from '../tools/cdp/host.js'
import { CdpSession, type CdpEventPage } from './cdp-session.js'

export type CdpBrowserSource = {
  tabList(): BrowserTabInfo[]
  contentsOf(tabId?: string): WebContents | null
}

/** Resolves stable ClosedAI tab ids into transient CDP attachments. */
export class BrowserCdpAccess implements CdpToolHost {
  private readonly sessions = new Map<string, CdpSession>()

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

  dispose(): void {
    for (const session of this.sessions.values()) session.dispose()
    this.sessions.clear()
  }

  private resolve(tabId?: string): { tab: BrowserTabInfo; session: CdpSession } {
    const browser = this.browser()
    if (!browser) throw new Error('The browser is not available yet')
    const tabs = browser.tabList()
    const tab = tabId ? tabs.find((candidate) => candidate.id === tabId) : tabs.find((candidate) => candidate.active)
    if (!tab) throw new Error(tabId ? `Browser tab ${tabId} does not exist` : 'There is no active browser tab')
    const contents = browser.contentsOf(tab.id)
    if (!contents) throw new Error(`Browser tab ${tab.id} is closed`)

    const current = this.sessions.get(tab.id)
    if (current?.contentsId === contents.id) return { tab, session: current }
    current?.dispose()
    const session = new CdpSession(tab.id, contents, (closed) => {
      if (this.sessions.get(tab.id) === closed) this.sessions.delete(tab.id)
    })
    this.sessions.set(tab.id, session)
    return { tab, session }
  }
}
