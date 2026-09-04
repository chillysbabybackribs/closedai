// The app owns the browser session, so it sees every request from every tab through
// Electron's webRequest hooks: no debugger, no per-tab enable step, nothing lost when a page
// navigates. This log is that always-on record. It is pure state so it can be tested without
// Electron; network-observer.ts feeds it and the network tool queries it.

export type NetworkHeaders = Record<string, string>

export type NetworkRequestState = 'pending' | 'completed' | 'failed' | 'blocked'

export type NetworkPostData = { text: string | null; byteLength: number; truncated: boolean }

export type NetworkRecord = {
  /** Electron's per-request id, stable across the request's lifecycle events. */
  id: string
  cursor: number
  /** Null for requests the app itself made through the session (session fetch, replay). */
  tabId: string | null
  url: string
  method: string
  resourceType: string
  referrer: string | null
  startedAt: number
  endedAt: number | null
  durationMs: number | null
  status: number | null
  statusLine: string | null
  mimeType: string | null
  fromCache: boolean | null
  requestHeaders: NetworkHeaders | null
  responseHeaders: NetworkHeaders | null
  redirects: string[]
  postData: NetworkPostData | null
  error: string | null
  state: NetworkRequestState
  /** The rule that blocked or redirected this request, when one did. */
  ruleId: string | null
}

export type NetworkListFilter = {
  tabId?: string
  /** Case-insensitive substring of the URL. */
  url?: string
  /** Case-insensitive substring of the resource type (xhr, fetch, script, image…). */
  type?: string
  method?: string
  status?: number
  state?: NetworkRequestState
  /** Only records recorded after this cursor; enables incremental reads. */
  afterCursor?: number
  limit: number
  includeHeaders?: boolean
}

export type NetworkListing = {
  matched: number
  returned: number
  oldestCursor: number
  nextCursor: number
  requests: Array<NetworkRecord | NetworkSummary>
}

export type NetworkSummary = Omit<NetworkRecord, 'requestHeaders' | 'responseHeaders' | 'postData'> & {
  hasPostData: boolean
}

export type NetworkWait = {
  tabId?: string
  url?: string
  method?: string
  afterCursor: number
  timeoutMs: number
}

export type NetworkWaitResult =
  | { matched: true; elapsedMs: number; request: NetworkRecord }
  | { matched: false; elapsedMs: number; timedOut: true }

type Waiter = { wait: NetworkWait; resolve: (record: NetworkRecord) => void }

const DEFAULT_CAPACITY = 2_000
const MAX_HEADER_VALUE_CHARS = 2_000

export class NetworkLog {
  private readonly records: NetworkRecord[] = []
  private readonly byId = new Map<string, NetworkRecord>()
  private readonly waiters = new Set<Waiter>()
  private nextCursor = 1

  constructor(
    private readonly capacity = DEFAULT_CAPACITY,
    private readonly now: () => number = () => Date.now()
  ) {}

  begin(input: {
    id: string
    tabId: string | null
    url: string
    method: string
    resourceType: string
    referrer?: string | null
    postData?: NetworkPostData | null
  }): NetworkRecord {
    const record: NetworkRecord = {
      id: input.id,
      cursor: this.nextCursor++,
      tabId: input.tabId,
      url: input.url,
      method: input.method,
      resourceType: input.resourceType,
      referrer: input.referrer ?? null,
      startedAt: this.now(),
      endedAt: null,
      durationMs: null,
      status: null,
      statusLine: null,
      mimeType: null,
      fromCache: null,
      requestHeaders: null,
      responseHeaders: null,
      redirects: [],
      postData: input.postData ?? null,
      error: null,
      state: 'pending',
      ruleId: null
    }
    this.records.push(record)
    this.byId.set(record.id, record)
    while (this.records.length > this.capacity) {
      const evicted = this.records.shift()
      if (evicted) this.byId.delete(evicted.id)
    }
    return record
  }

  get(id: string): NetworkRecord | null {
    return this.byId.get(id) ?? null
  }

  requestHeaders(id: string, headers: NetworkHeaders): void {
    const record = this.byId.get(id)
    if (record) record.requestHeaders = boundHeaders(headers)
  }

  redirected(id: string, redirectUrl: string, status: number | null): void {
    const record = this.byId.get(id)
    if (!record) return
    record.redirects.push(redirectUrl)
    if (status !== null) record.status = status
  }

  responseHeaders(id: string, input: { status: number | null; statusLine: string | null; headers: NetworkHeaders }): void {
    const record = this.byId.get(id)
    if (!record) return
    record.status = input.status
    record.statusLine = input.statusLine
    record.responseHeaders = boundHeaders(input.headers)
    record.mimeType = mimeTypeOf(input.headers)
  }

  complete(id: string, input: { status: number | null; fromCache: boolean | null }): void {
    const record = this.byId.get(id)
    if (!record) return
    if (input.status !== null) record.status = input.status
    record.fromCache = input.fromCache
    this.finish(record, 'completed')
  }

  fail(id: string, error: string): void {
    const record = this.byId.get(id)
    if (!record) return
    record.error = error
    // Chromium reports a request the rules cancelled as ERR_BLOCKED_BY_CLIENT, so this arrives
    // for every block. Keep the state that names the cause; the error string is kept either way.
    if (record.state === 'blocked') return
    this.finish(record, 'failed')
  }

  blocked(id: string, ruleId: string, redirectUrl?: string): void {
    const record = this.byId.get(id)
    if (!record) return
    record.ruleId = ruleId
    if (redirectUrl) {
      record.redirects.push(redirectUrl)
      return
    }
    this.finish(record, 'blocked')
  }

  list(filter: NetworkListFilter): NetworkListing {
    const kept = this.records.filter((record) => matches(record, filter))
    const oldestCursor = this.records[0]?.cursor ?? this.nextCursor
    // Incremental reads walk forward from the cursor; a plain listing shows what happened
    // most recently, still in the order it happened so a flow reads top to bottom.
    const page = filter.afterCursor === undefined
      ? kept.slice(Math.max(0, kept.length - filter.limit))
      : kept.slice(0, filter.limit)
    return {
      matched: kept.length,
      returned: page.length,
      oldestCursor,
      nextCursor: page.length ? page[page.length - 1].cursor : (filter.afterCursor ?? this.nextCursor - 1),
      requests: page.map((record) => filter.includeHeaders ? { ...record } : summarize(record))
    }
  }

  clear(tabId?: string): number {
    if (!tabId) {
      const count = this.records.length
      this.records.length = 0
      this.byId.clear()
      return count
    }
    let removed = 0
    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      if (this.records[index].tabId !== tabId) continue
      this.byId.delete(this.records[index].id)
      this.records.splice(index, 1)
      removed += 1
    }
    return removed
  }

  /** Resolve with the first finished request matching `wait`, or time out. */
  waitFor(wait: NetworkWait): Promise<NetworkWaitResult> {
    const started = this.now()
    const already = this.records.find((record) =>
      record.cursor > wait.afterCursor && record.state !== 'pending' && matches(record, waitFilter(wait))
    )
    if (already) return Promise.resolve({ matched: true, elapsedMs: 0, request: { ...already } })
    return new Promise((resolve) => {
      const waiter: Waiter = {
        wait,
        resolve: (record) => {
          clearTimeout(timer)
          this.waiters.delete(waiter)
          resolve({ matched: true, elapsedMs: this.now() - started, request: { ...record } })
        }
      }
      const timer = setTimeout(() => {
        this.waiters.delete(waiter)
        resolve({ matched: false, elapsedMs: this.now() - started, timedOut: true })
      }, wait.timeoutMs)
      this.waiters.add(waiter)
    })
  }

  private finish(record: NetworkRecord, state: Exclude<NetworkRequestState, 'pending'>): void {
    record.state = state
    record.endedAt = this.now()
    record.durationMs = Math.max(0, record.endedAt - record.startedAt)
    for (const waiter of [...this.waiters]) {
      if (record.cursor > waiter.wait.afterCursor && matches(record, waitFilter(waiter.wait))) waiter.resolve(record)
    }
  }
}

function waitFilter(wait: NetworkWait): NetworkListFilter {
  return { tabId: wait.tabId, url: wait.url, method: wait.method, limit: 1 }
}

function matches(record: NetworkRecord, filter: NetworkListFilter): boolean {
  if (filter.tabId && record.tabId !== filter.tabId) return false
  if (filter.url && !record.url.toLowerCase().includes(filter.url.toLowerCase())) return false
  if (filter.type && !record.resourceType.toLowerCase().includes(filter.type.toLowerCase())) return false
  if (filter.method && record.method.toUpperCase() !== filter.method.toUpperCase()) return false
  if (filter.status !== undefined && record.status !== filter.status) return false
  if (filter.state && record.state !== filter.state) return false
  if (filter.afterCursor !== undefined && record.cursor <= filter.afterCursor) return false
  return true
}

function summarize(record: NetworkRecord): NetworkSummary {
  const { requestHeaders: _request, responseHeaders: _response, postData, ...rest } = record
  return { ...rest, hasPostData: postData !== null && postData.byteLength > 0 }
}

function boundHeaders(headers: NetworkHeaders): NetworkHeaders {
  const bounded: NetworkHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    bounded[name.toLowerCase()] = value.length > MAX_HEADER_VALUE_CHARS ? value.slice(0, MAX_HEADER_VALUE_CHARS) + '…' : value
  }
  return bounded
}

function mimeTypeOf(headers: NetworkHeaders): string | null {
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === 'content-type')
  if (!entry) return null
  return entry[1].split(';')[0].trim() || null
}

/** Electron reports response headers as string arrays; the log keeps one string per header. */
export function flattenHeaders(headers: Record<string, string | string[]> | undefined): NetworkHeaders {
  const flat: NetworkHeaders = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    flat[name] = Array.isArray(value) ? value.join(', ') : value
  }
  return flat
}
