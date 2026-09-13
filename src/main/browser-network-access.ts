import type { BrowserService } from './browser-service.js'
import type { NetworkListFilter, NetworkListing, NetworkRecord, NetworkWait, NetworkWaitResult } from './browser-network/network-log.js'
import type { NetworkRule, NetworkRuleInput } from './browser-network/network-rules.js'
import { listCookies, removeCookie, setCookie, type CookieFilter, type CookieInput, type CookieRecord } from './browser-network/session-cookies.js'
import { fetchWithSession, replayableHeaders, type SessionFetchRequest, type SessionFetchResult } from './browser-network/session-fetch.js'
import type { CdpToolHost } from './tools/cdp/host.js'
import type { NetworkBodyResult, NetworkToolHost, SessionToolHost } from './tools/browser/index.js'

/**
 * NetworkToolHost and SessionToolHost over the live BrowserService: the session's request log
 * and rules, and requests and cookies on the session itself. Bodies come from the tab's
 * debugger buffer when it has one, and otherwise from replaying the recorded request on the
 * same session, so a body is reachable for anything the log saw.
 */
export class BrowserNetworkAccess implements NetworkToolHost, SessionToolHost {
  constructor(
    private readonly browser: () => BrowserService | null,
    private readonly cdp: () => CdpToolHost | null
  ) {}

  requests(filter: NetworkListFilter): NetworkListing {
    return this.service().observers.network.list(filter)
  }

  waitFor(wait: NetworkWait): Promise<NetworkWaitResult> {
    return this.service().observers.network.waitFor(wait)
  }

  rules(): NetworkRule[] {
    return this.service().observers.rules.list()
  }

  addRule(input: NetworkRuleInput): NetworkRule {
    return this.service().observers.rules.add(input)
  }

  removeRule(id: string): boolean {
    return this.service().observers.rules.remove(id)
  }

  clear(tabId?: string): number {
    return this.service().observers.network.clear(tabId)
  }

  async body(id: string): Promise<NetworkBodyResult> {
    const service = this.service()
    const record = service.observers.network.get(id)
    if (!record) throw new Error(`No recorded request with id ${id}; ids come from requests or wait`)
    if (record.state === 'blocked') throw new Error(`Request ${id} was blocked by rule ${record.ruleId ?? '?'}; it has no body`)
    const captured = await this.capturedBody(record)
    if (captured) return captured
    return this.replayBody(service, record)
  }

  fetch(request: SessionFetchRequest): Promise<SessionFetchResult> {
    const browserSession = this.service().session
    return fetchWithSession((url, init) => browserSession.fetch(url, init), request)
  }

  cookies(filter: CookieFilter): Promise<{ matched: number; cookies: CookieRecord[] }> {
    return listCookies(this.service().session.cookies, filter)
  }

  setCookie(input: CookieInput): Promise<CookieRecord> {
    return setCookie(this.service().session.cookies, input)
  }

  removeCookie(input: { url?: string; domain?: string; name: string }): Promise<{ removed: number }> {
    return removeCookie(this.service().session.cookies, input)
  }

  private service(): BrowserService {
    const service = this.browser()
    if (!service) throw new Error('The browser is not available yet')
    return service
  }

  /** The body as the tab's debugger buffered it, when Network capture was on for that tab. */
  private async capturedBody(record: NetworkRecord): Promise<NetworkBodyResult | null> {
    const cdp = this.cdp()
    if (!cdp || !record.tabId) return null
    try {
      const listing = await cdp.networkRequests(record.tabId, { url: record.url, limit: 50 }) as {
        requests?: Array<{ url: string; method: string | null; requestId: string | null; sessionId?: string | null }>
      }
      const match = listing.requests?.find((candidate) =>
        candidate.requestId && candidate.url === record.url && (!candidate.method || candidate.method === record.method)
      )
      if (!match?.requestId) return null
      const body = await cdp.responseBody(record.tabId, match.requestId, match.sessionId ?? undefined) as {
        text: string | null; base64Encoded: boolean; byteLength: number; note?: string
      }
      return {
        id: record.id,
        url: record.url,
        method: record.method,
        status: record.status,
        source: 'captured',
        contentType: record.mimeType,
        text: body.text,
        base64: null,
        byteLength: body.byteLength,
        truncated: false,
        ...(body.note ? { note: body.note } : {})
      }
    } catch {
      // A body the tab no longer holds, or a tab that cannot attach: replay answers instead.
      return null
    }
  }

  private async replayBody(service: BrowserService, record: NetworkRecord): Promise<NetworkBodyResult> {
    if (record.postData && record.postData.text === null) {
      throw new Error(`Request ${record.id} carried a binary or file upload body, which cannot be replayed`)
    }
    const browserSession = service.session
    const response = await fetchWithSession((url, init) => browserSession.fetch(url, init), {
      url: record.url,
      method: record.method,
      headers: replayableHeaders(record.requestHeaders),
      body: record.postData?.text ?? undefined
    })
    return {
      id: record.id,
      url: record.url,
      method: record.method,
      status: response.status,
      source: 'replay',
      contentType: response.contentType,
      text: response.text,
      base64: response.base64,
      byteLength: response.byteLength,
      truncated: response.truncated,
      note: 'The request was issued again on the session with its recorded headers and post data; a non-idempotent endpoint ran twice.'
    }
  }
}
