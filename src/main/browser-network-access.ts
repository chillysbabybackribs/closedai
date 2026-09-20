import type { BrowserService } from './browser-service.js'
import type { NetworkListFilter, NetworkListing, NetworkRecord, NetworkWait, NetworkWaitResult } from './browser-network/network-log.js'
import type { NetworkRule, NetworkRuleInput } from './browser-network/network-rules.js'
import { listCookies, removeCookie, setCookie, type CookieFilter, type CookieInput, type CookieRecord } from './browser-network/session-cookies.js'
import { fetchWithSession, replayableHeaders, type SessionFetchRequest, type SessionFetchResult } from './browser-network/session-fetch.js'
import type { NetworkBodyResult, NetworkToolHost, SessionToolHost } from './tools/browser/index.js'

/**
 * NetworkToolHost and SessionToolHost over the live BrowserService: the session's request log
 * and rules, and requests and cookies on the session itself. Replay is an explicit new
 * request. Historical bodies belong to CDP's exact request/session identity instead.
 */
export class BrowserNetworkAccess implements NetworkToolHost, SessionToolHost {
  constructor(
    private readonly browser: () => BrowserService | null
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

  async replay(id: string): Promise<NetworkBodyResult> {
    const service = this.service()
    const record = service.observers.network.get(id)
    if (!record) throw new Error(`No recorded request with id ${id}; ids come from requests or wait`)
    if (record.state === 'blocked') throw new Error(`Request ${id} was blocked by rule ${record.ruleId ?? '?'}; it has no body`)
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

  private async replayBody(service: BrowserService, record: NetworkRecord): Promise<NetworkBodyResult> {
    if (record.postData && (record.postData.text === null || record.postData.truncated)) {
      throw new Error(`Request ${record.id} has an incomplete, binary or file upload body, which cannot be replayed`)
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
      note: 'Explicit new request using the current session and recorded method, headers and post data; this is not the historical response and may repeat server-side effects.'
    }
  }
}
