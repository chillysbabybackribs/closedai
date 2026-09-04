import type { NetworkListFilter, NetworkListing, NetworkWait, NetworkWaitResult } from '../../browser-network/network-log.js'
import type { NetworkRule, NetworkRuleInput } from '../../browser-network/network-rules.js'
import type { CookieFilter, CookieInput, CookieRecord } from '../../browser-network/session-cookies.js'
import type { SessionFetchRequest, SessionFetchResult } from '../../browser-network/session-fetch.js'

export type NetworkBodyResult = {
  id: string
  url: string
  method: string
  status: number | null
  /** captured: read from the tab's debugger buffer; replay: the request was issued again on the session. */
  source: 'captured' | 'replay'
  contentType: string | null
  text: string | null
  base64: string | null
  byteLength: number
  truncated: boolean
  note?: string
}

/**
 * What the network tool needs from the session-level observer. browser-network-access.ts
 * implements it over BrowserService; tests pass a fake. Tools never see BrowserService.
 */
export type NetworkToolHost = {
  requests(filter: NetworkListFilter): NetworkListing
  waitFor(wait: NetworkWait): Promise<NetworkWaitResult>
  body(id: string): Promise<NetworkBodyResult>
  rules(): NetworkRule[]
  addRule(input: NetworkRuleInput): NetworkRule
  removeRule(id: string): boolean
  clear(tabId?: string): number
}

/** Session-scoped requests and cookie storage: the user's signed-in session, no page required. */
export type SessionToolHost = {
  fetch(request: SessionFetchRequest): Promise<SessionFetchResult>
  cookies(filter: CookieFilter): Promise<{ matched: number; cookies: CookieRecord[] }>
  setCookie(input: CookieInput): Promise<CookieRecord>
  removeCookie(input: { url?: string; domain?: string; name: string }): Promise<{ removed: number }>
}

export type NetworkHostProvider = () => NetworkToolHost | null
export type SessionHostProvider = () => SessionToolHost | null

export function requireNetwork(provider: NetworkHostProvider): NetworkToolHost {
  const host = provider()
  if (!host) throw new Error('The browser network observer is not available yet')
  return host
}

export function requireSession(provider: SessionHostProvider): SessionToolHost {
  const host = provider()
  if (!host) throw new Error('The browser session is not available yet')
  return host
}
