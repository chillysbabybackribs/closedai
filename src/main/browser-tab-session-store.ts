import { readFile } from 'node:fs/promises'
import { writeAtomic } from './atomic-write.js'
import type { BrowserTabInfo } from '../shared/types.js'
import { TAB_ID_PATTERN } from '../shared/browser-tabs.js'
import {
  normalizeNavigationStack,
  type PersistedNavigationStack
} from './browser-navigation-stack.js'

// Durable tab strip: which pages were open, in what order, and which one the user was
// looking at. The persist:browser partition already carries cookies/localStorage across
// restarts, so restoring the URL list is the only missing piece of "the browser is where
// I left it" — after a quit, a crash, or a forced reload.
//
// Written on every tab-strip change (debounced) rather than only at quit, because a crash
// never gets a quit hook. Reading is best-effort: a missing or malformed file means a
// normal fresh start, never a failed launch.

export type PersistedTab = {
  url: string
  title: string
  customTitle?: string | null
  /**
   * The app-assigned id, restored so a model's `tab_id` from before a restart still names
   * the same page. Absent in files written before ids were persisted.
   */
  id?: string
  /** Back/forward stack from `navigationHistory.getAllEntries()`, when more than one entry. */
  stack?: PersistedNavigationStack
}

/** Tab strip metadata plus optional navigation stack for session persistence. */
export type TabPersistRecord = BrowserTabInfo & {
  stack?: PersistedNavigationStack | null
}

export type RestoredTabSession = {
  tabs: PersistedTab[]
  activeIndex: number
}

type PersistedTabSession = {
  version: 1
  tabs: PersistedTab[]
  activeIndex: number
}

// Short enough that a crash loses at most the last flick of a tab switch, long enough
// that a burst of state events during a page load collapses to one write.
const WRITE_DEBOUNCE_MS = 400
// A restored tab is a real WebContentsView with a real renderer. Bound the set so a
// runaway multi-agent sweep that left 60 tabs open cannot make the next launch unusable.
export const MAX_RESTORED_TABS = 24
// Titles are only strip labels; keep the file small and free of page-sized junk.
const MAX_TITLE_LENGTH = 300

export class BrowserTabSessionStore {
  private state: PersistedTabSession
  private writeQueue: Promise<void> = Promise.resolve()
  private writeTimer: ReturnType<typeof setTimeout> | null = null
  // Latched at shutdown: teardown must not overwrite the session we just persisted.
  private closed = false
  // Last reported cap overflow, so a strip that stays over the cap logs once, not per change.
  private notedDrop = 0

  private constructor(
    private readonly filePath: string,
    state: PersistedTabSession
  ) {
    this.state = state
  }

  static async open(filePath: string): Promise<BrowserTabSessionStore> {
    const state = await readSession(filePath)
    return new BrowserTabSessionStore(filePath, state ?? { version: 1, tabs: [], activeIndex: 0 })
  }

  // The tabs a new window should open with: the previous run's strip at launch, or — on a
  // platform where closing the window doesn't quit the app — whatever the strip held when it
  // closed. Null means "nothing to restore", i.e. open a home tab as usual.
  restored(): RestoredTabSession | null {
    if (this.state.tabs.length === 0) return null
    return { tabs: this.state.tabs, activeIndex: this.state.activeIndex }
  }

  // Fed straight from BrowserService's 'tabs' event, so the persisted record is always the
  // live strip — no separate bookkeeping to drift out of sync.
  save(tabs: TabPersistRecord[]): void {
    if (this.closed) return
    const next = selectPersistableTabs(tabs)
    // The cap is a real loss of state; say so rather than let a short restore look complete.
    if (next.droppedToCap !== this.notedDrop) {
      this.notedDrop = next.droppedToCap
      if (next.droppedToCap > 0) {
        console.warn(`[tab-session] ${next.droppedToCap} tab(s) over the ${MAX_RESTORED_TABS}-tab restore cap will not reopen`)
      }
    }
    if (sameSession(this.state, next)) return
    this.state = { version: 1, tabs: next.tabs, activeIndex: next.activeIndex }
    this.scheduleWrite()
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    const snapshot = JSON.stringify(this.state)
    this.writeQueue = this.writeQueue.then(() =>
      writeAtomic(this.filePath, snapshot).catch(() => {
        // A failed write is non-fatal: the session simply stays at its last good value.
      })
    )
    await this.writeQueue
  }

  // Final write at shutdown, after which further 'tabs' events (dispose, window teardown)
  // are ignored so a closing browser cannot persist itself as an empty session.
  async close(): Promise<void> {
    await this.flush()
    this.closed = true
  }

  private scheduleWrite(): void {
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      void this.flush()
    }, WRITE_DEBOUNCE_MS)
    // A pending tab-session write must never hold the process open at shutdown; the
    // explicit close() above is what guarantees the last state lands.
    this.writeTimer.unref?.()
  }
}

// Which of the live tabs are worth bringing back, and which one to show. Only real
// addressable http(s) pages restore meaningfully — about:blank, file://, devtools and
// friends would come back as empty shells. Dropping them renumbers the strip, so the
// active index is computed against the kept list, not the original one.
export function selectPersistableTabs(tabs: TabPersistRecord[]): RestoredTabSession & { droppedToCap: number } {
  const kept: PersistedTab[] = []
  let activeIndex = 0
  for (const tab of tabs) {
    if (!isRestorableUrl(tab.url)) continue
    if (tab.active) activeIndex = kept.length
    const stack = normalizeNavigationStack(tab.stack ?? null)
    kept.push({
      url: tab.url,
      title: (tab.title ?? '').slice(0, MAX_TITLE_LENGTH),
      ...(normalizeCustomTitle(tab.customTitle) ? { customTitle: normalizeCustomTitle(tab.customTitle) } : {}),
      ...(TAB_ID_PATTERN.test(tab.id) ? { id: tab.id } : {}),
      ...(stack ? { stack } : {})
    })
  }
  if (kept.length <= MAX_RESTORED_TABS) return { tabs: kept, activeIndex, droppedToCap: 0 }
  // Over the cap: keep a window centered on the tab the user was actually looking at
  // rather than an arbitrary prefix that might not contain it.
  const start = Math.min(
    Math.max(activeIndex - Math.floor(MAX_RESTORED_TABS / 2), 0),
    kept.length - MAX_RESTORED_TABS
  )
  return {
    tabs: kept.slice(start, start + MAX_RESTORED_TABS),
    activeIndex: activeIndex - start,
    droppedToCap: kept.length - MAX_RESTORED_TABS
  }
}

// Which tab a restore should show, and the order the pages should load in: the one the user
// will actually be looking at first, then the rest left-to-right. Returned as indices into
// the session's tab list, with the active index clamped against a hand-edited file.
export function restorePlan(count: number, activeIndex: number): { activeIndex: number; loadOrder: number[] } {
  const active = Math.min(Math.max(Math.floor(activeIndex) || 0, 0), Math.max(count - 1, 0))
  const rest = Array.from({ length: count }, (_unused, index) => index).filter((index) => index !== active)
  return { activeIndex: active, loadOrder: count === 0 ? [] : [active, ...rest] }
}

function isRestorableUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function sameSession(current: PersistedTabSession, next: RestoredTabSession): boolean {
  return (
    current.activeIndex === next.activeIndex &&
    current.tabs.length === next.tabs.length &&
    current.tabs.every((tab, index) => (
      tab.url === next.tabs[index].url &&
      tab.title === next.tabs[index].title &&
      (tab.customTitle ?? null) === (next.tabs[index].customTitle ?? null) &&
      (tab.id ?? null) === (next.tabs[index].id ?? null) &&
      navigationStacksEqual(tab.stack, next.tabs[index].stack)
    ))
  )
}

function navigationStacksEqual(
  left: PersistedNavigationStack | undefined,
  right: PersistedNavigationStack | undefined
): boolean {
  if (!left && !right) return true
  if (!left || !right) return false
  if (left.index !== right.index || left.entries.length !== right.entries.length) return false
  return left.entries.every((entry, index) => {
    const other = right.entries[index]
    return entry.url === other.url &&
      entry.title === other.title &&
      (entry.pageState ?? null) === (other.pageState ?? null)
  })
}

type MaybePersisted = { version?: unknown; tabs?: unknown; activeIndex?: unknown }

async function readSession(filePath: string): Promise<PersistedTabSession | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as MaybePersisted
    return normalizeSession(parsed)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code !== 'ENOENT') console.warn('Unable to read browser tab session; starting clean', error)
    return null
  }
}

// Every field is re-validated: a truncated or hand-edited file must degrade to "fewer tabs
// restored", never to a launch that throws or opens a garbage URL.
export function normalizeSession(value: unknown): PersistedTabSession | null {
  if (!value || typeof value !== 'object') return null
  const parsed = value as MaybePersisted
  if (parsed.version !== 1 || !Array.isArray(parsed.tabs)) return null
  const tabs = parsed.tabs.map(normalizeTab).filter((tab): tab is PersistedTab => tab !== null)
  const tabsInBounds = tabs.slice(0, MAX_RESTORED_TABS)
  const rawIndex = typeof parsed.activeIndex === 'number' ? Math.floor(parsed.activeIndex) : 0
  const activeIndex = Math.min(Math.max(rawIndex, 0), Math.max(tabsInBounds.length - 1, 0))
  return { version: 1, tabs: tabsInBounds, activeIndex }
}

function normalizeTab(value: unknown): PersistedTab | null {
  if (!value || typeof value !== 'object') return null
  const tab = value as Partial<PersistedTab>
  if (typeof tab.url !== 'string' || !isRestorableUrl(tab.url)) return null
  const title = typeof tab.title === 'string' ? tab.title.slice(0, MAX_TITLE_LENGTH) : ''
  const customTitle = normalizeCustomTitle(tab.customTitle)
  const id = typeof tab.id === 'string' && TAB_ID_PATTERN.test(tab.id) ? tab.id : null
  const stack = normalizeNavigationStack((tab as Partial<PersistedTab>).stack)
  return {
    url: tab.url,
    title,
    ...(customTitle ? { customTitle } : {}),
    ...(id ? { id } : {}),
    ...(stack ? { stack } : {})
  }
}

function normalizeCustomTitle(title: unknown): string | null {
  if (typeof title !== 'string') return null
  const normalized = title.trim()
  return normalized ? normalized.slice(0, MAX_TITLE_LENGTH) : null
}
