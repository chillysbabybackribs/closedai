import type { WebContents } from 'electron'

// Every tab's console, captured from the WebContents event the app already receives for
// zoom gestures: no debugger, no Log.enable, nothing to switch on before the error happened.
// Navigations are recorded as markers so "errors since the last load" is one filter.

export type ConsoleLevel = 'debug' | 'info' | 'warning' | 'error'

export type ConsoleEntry = {
  cursor: number
  tabId: string
  at: number
  kind: 'message' | 'navigation'
  level: ConsoleLevel
  message: string
  source: string | null
  line: number | null
  /** URL of the frame that logged, when Electron reports it. */
  frameUrl: string | null
}

export type ConsoleFilter = {
  tabId: string
  afterCursor?: number
  /** Minimum level: error keeps errors only, warning keeps warnings and errors, and so on. */
  minLevel?: ConsoleLevel
  contains?: string
  /** Only entries since the tab's most recent navigation marker. */
  sinceNavigation?: boolean
  limit: number
}

export type ConsoleListing = {
  matched: number
  returned: number
  nextCursor: number
  lastNavigationAt: number | null
  entries: ConsoleEntry[]
}

/** The console-message event details as Electron 44 delivers them. */
export type ConsoleMessageDetails = {
  level: 'debug' | 'info' | 'warning' | 'error' | number
  message: string
  lineNumber?: number
  sourceId?: string
  frame?: { url?: string } | null
}

const LEVEL_RANK: Record<ConsoleLevel, number> = { debug: 0, info: 1, warning: 2, error: 3 }
const DEFAULT_CAPACITY = 1_500
const MAX_MESSAGE_CHARS = 4_000

export class ConsoleLog {
  private readonly entries: ConsoleEntry[] = []
  private nextCursor = 1

  constructor(
    /** Messages the app itself emits into pages (for example the zoom gesture) are noise here. */
    private readonly ignore: (message: string) => boolean = () => false,
    private readonly capacity = DEFAULT_CAPACITY,
    private readonly now: () => number = () => Date.now()
  ) {}

  attach(tabId: string, contents: Pick<WebContents, 'on'>): void {
    contents.on('console-message', (details: ConsoleMessageDetails) => this.message(tabId, details))
    contents.on('did-navigate', (_event: unknown, url: string) => this.navigation(tabId, url))
  }

  message(tabId: string, details: ConsoleMessageDetails): void {
    if (this.ignore(details.message)) return
    this.push({
      tabId,
      kind: 'message',
      level: levelOf(details.level),
      message: details.message.length > MAX_MESSAGE_CHARS ? details.message.slice(0, MAX_MESSAGE_CHARS) + '…' : details.message,
      source: details.sourceId || null,
      line: typeof details.lineNumber === 'number' ? details.lineNumber : null,
      frameUrl: details.frame?.url ?? null
    })
  }

  navigation(tabId: string, url: string): void {
    this.push({ tabId, kind: 'navigation', level: 'info', message: `navigated to ${url}`, source: null, line: null, frameUrl: url })
  }

  list(filter: ConsoleFilter): ConsoleListing {
    const navigation = [...this.entries].reverse().find((entry) => entry.tabId === filter.tabId && entry.kind === 'navigation')
    const floor = filter.sinceNavigation && navigation ? navigation.cursor : 0
    const minRank = LEVEL_RANK[filter.minLevel ?? 'debug']
    const needle = filter.contains?.toLowerCase()
    const kept = this.entries.filter((entry) => {
      if (entry.tabId !== filter.tabId || entry.cursor < floor) return false
      if (filter.afterCursor !== undefined && entry.cursor <= filter.afterCursor) return false
      if (entry.kind === 'message' && LEVEL_RANK[entry.level] < minRank) return false
      if (needle && !entry.message.toLowerCase().includes(needle)) return false
      return true
    })
    const page = filter.afterCursor === undefined ? kept.slice(Math.max(0, kept.length - filter.limit)) : kept.slice(0, filter.limit)
    return {
      matched: kept.length,
      returned: page.length,
      nextCursor: page.length ? page[page.length - 1].cursor : (filter.afterCursor ?? this.nextCursor - 1),
      lastNavigationAt: navigation?.at ?? null,
      entries: page.map((entry) => ({ ...entry }))
    }
  }

  clear(tabId?: string): number {
    if (!tabId) {
      const count = this.entries.length
      this.entries.length = 0
      return count
    }
    const before = this.entries.length
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      if (this.entries[index].tabId === tabId) this.entries.splice(index, 1)
    }
    return before - this.entries.length
  }

  private push(entry: Omit<ConsoleEntry, 'cursor' | 'at'>): void {
    this.entries.push({ ...entry, cursor: this.nextCursor++, at: this.now() })
    while (this.entries.length > this.capacity) this.entries.shift()
  }
}

function levelOf(level: ConsoleMessageDetails['level']): ConsoleLevel {
  if (typeof level === 'string') return level
  // Older Electron builds report 0..3 for verbose, info, warning, error.
  return (['debug', 'info', 'warning', 'error'] as const)[Math.max(0, Math.min(3, level))]
}
