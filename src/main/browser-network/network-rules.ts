// Interception the owner's way: the session's blocking webRequest stages decide a request's
// fate before it leaves, so blocking, redirecting, and rewriting headers costs no debugger and
// pauses nothing. Rules are plain data with a hit count so the model can see whether one fired.

export type NetworkRuleAction = 'block' | 'redirect' | 'request_headers' | 'response_headers'

export type NetworkRule = {
  id: string
  action: NetworkRuleAction
  /** Glob over the full URL (`*` matches anything); a pattern without `*` matches as a substring. */
  urlPattern: string
  /** Null applies to every tab and to the app's own session requests. */
  tabId: string | null
  redirectUrl: string | null
  /** Header name to value; null removes the header. Names are matched case-insensitively. */
  headers: Record<string, string | null> | null
  note: string | null
  hits: number
}

export type NetworkRuleInput = {
  action: NetworkRuleAction
  urlPattern: string
  tabId?: string | null
  redirectUrl?: string | null
  headers?: Record<string, string | null> | null
  note?: string | null
}

const MAX_RULES = 50

export class NetworkRules {
  private readonly rules = new Map<string, NetworkRule & { matcher: RegExp | null }>()
  private nextId = 1

  add(input: NetworkRuleInput): NetworkRule {
    if (this.rules.size >= MAX_RULES) throw new Error(`At most ${MAX_RULES} network rules can be active; remove one first`)
    if (!input.urlPattern.trim()) throw new Error('`url_pattern` must not be empty')
    if (input.action === 'redirect' && !input.redirectUrl) throw new Error('A redirect rule needs `redirect_url`')
    if ((input.action === 'request_headers' || input.action === 'response_headers') && !hasHeaders(input.headers)) {
      throw new Error('A header rule needs a non-empty `headers` object')
    }
    const rule = {
      id: `rule-${this.nextId++}`,
      action: input.action,
      urlPattern: input.urlPattern,
      tabId: input.tabId ?? null,
      redirectUrl: input.action === 'redirect' ? input.redirectUrl ?? null : null,
      headers: input.action === 'request_headers' || input.action === 'response_headers' ? normalizeHeaderNames(input.headers) : null,
      note: input.note ?? null,
      hits: 0,
      matcher: globToRegExp(input.urlPattern)
    }
    this.rules.set(rule.id, rule)
    return publicRule(rule)
  }

  remove(id: string): boolean {
    return this.rules.delete(id)
  }

  list(): NetworkRule[] {
    return [...this.rules.values()].map(publicRule)
  }

  /** The first block or redirect rule that applies; block wins over redirect. */
  decide(url: string, tabId: string | null): { cancel: true; ruleId: string } | { redirectUrl: string; ruleId: string } | null {
    const applicable = [...this.rules.values()].filter((rule) => applies(rule, url, tabId))
    const block = applicable.find((rule) => rule.action === 'block')
    if (block) {
      block.hits += 1
      return { cancel: true, ruleId: block.id }
    }
    const redirect = applicable.find((rule) => rule.action === 'redirect' && rule.redirectUrl)
    if (!redirect || !redirect.redirectUrl) return null
    redirect.hits += 1
    return { redirectUrl: redirect.redirectUrl, ruleId: redirect.id }
  }

  applyRequestHeaders(url: string, tabId: string | null, headers: Record<string, string | string[]>): void {
    this.applyHeaders('request_headers', url, tabId, headers)
  }

  applyResponseHeaders(url: string, tabId: string | null, headers: Record<string, string | string[]>): void {
    this.applyHeaders('response_headers', url, tabId, headers)
  }

  private applyHeaders(
    action: 'request_headers' | 'response_headers',
    url: string,
    tabId: string | null,
    headers: Record<string, string | string[]>
  ): void {
    for (const rule of this.rules.values()) {
      if (rule.action !== action || !rule.headers || !applies(rule, url, tabId)) continue
      rule.hits += 1
      for (const [name, value] of Object.entries(rule.headers)) {
        // Existing headers keep their original casing; a rule replaces whichever spelling exists.
        const existing = Object.keys(headers).find((key) => key.toLowerCase() === name)
        if (existing) delete headers[existing]
        if (value !== null) headers[existing ?? name] = value
      }
    }
  }
}

function applies(rule: NetworkRule & { matcher: RegExp | null }, url: string, tabId: string | null): boolean {
  if (rule.tabId && rule.tabId !== tabId) return false
  return rule.matcher ? rule.matcher.test(url) : url.toLowerCase().includes(rule.urlPattern.toLowerCase())
}

function publicRule(rule: NetworkRule & { matcher: RegExp | null }): NetworkRule {
  const { matcher: _matcher, ...rest } = rule
  return { ...rest, headers: rest.headers ? { ...rest.headers } : null }
}

function hasHeaders(headers: Record<string, string | null> | null | undefined): boolean {
  return !!headers && Object.keys(headers).length > 0
}

function normalizeHeaderNames(headers: Record<string, string | null> | null | undefined): Record<string, string | null> {
  const normalized: Record<string, string | null> = {}
  for (const [name, value] of Object.entries(headers ?? {})) normalized[name.toLowerCase()] = value
  return normalized
}

/** `*` is the only wildcard; anything else is literal. Null means substring matching. */
export function globToRegExp(pattern: string): RegExp | null {
  if (!pattern.includes('*')) return null
  const escaped = pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${escaped}$`, 'i')
}
