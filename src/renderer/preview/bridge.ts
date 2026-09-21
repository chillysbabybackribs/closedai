import type { ClosedaiApi } from '../../shared/api.js'
import type { BrowserBounds, BrowserState, BrowserTabInfo } from '../../shared/types.js'
import type { LibrarySnapshot } from '../../shared/research-library.js'
import type { ProviderAvailability } from '../../shared/provider-availability.js'
import { createPreviewChat } from './chat.js'
import type { Scenario } from './fixtures.js'
import { createToolsFixture } from './tools-fixture.js'

/** Compile-time complete: additions to the real bridge must be considered here too. */
export function createPreviewBridge(scenario: Scenario, report: (message: string) => void,
  boundsChanged: (bounds: BrowserBounds) => void) {
  const chat = createPreviewChat(scenario, report)
  const native = async () => { report('This action requires real Electron; it is unavailable in the UI preview.') }
  const unavailable = async (): Promise<never> => {
    await native()
    throw new Error('Unavailable in the browser UI preview')
  }
  const idleSubscription = () => () => {}
  const samplePaper = (id: string, title: string, topic: string, daysAgo: number): LibrarySnapshot['papers'][number] => ({
    id, title, topics: [topic], url: `https://alphaxiv.org/abs/${id}`, sha256: id.padEnd(64, '0'),
    abstract: `Preview abstract for ${title}. Two paragraphs of discovery text stand in for the retrieved abstract so the row, its panel, and the open action can be exercised without a network call.`,
    abstractTruncated: false,
    publishedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    retrievedAt: new Date(Date.now() - 3_600_000).toISOString()
  })
  const library: LibrarySnapshot = { settings: { topics: ['Coding agent harness design'], enabled: true, lookbackDays: 30 },
    refreshing: false, lastRefresh: null, dismissed: 0, total: 2, papers: [
      samplePaper('2609.20804', 'An Empirical Study of Harness Design for Coding Agents', 'Coding agent harness design', 4),
      samplePaper('2609.19877', 'JustMem: Just-Enough Memory Access for Long-Term Conversations', 'Coding agent harness design', 6)
    ] }
  let tabs: BrowserTabInfo[] = [{ id: 'preview-tab-1', pos: 1, title: 'Sample browser tab',
    url: 'about:blank', favicon: null, isLoading: false, active: true }]
  let tabSequence = 1
  const stateListeners = new Set<(state: BrowserState) => void>()
  const tabListeners = new Set<(tabs: BrowserTabInfo[]) => void>()
  const browserState = (): BrowserState => {
    const tab = tabs.find((entry) => entry.active)
    return { url: tab?.url ?? 'about:blank', title: tab?.title ?? 'New tab',
      isLoading: false, canGoBack: false, canGoForward: false }
  }
  const publishBrowser = () => {
    tabs = tabs.map((tab, index) => ({ ...tab, pos: index + 1 }))
    stateListeners.forEach((listener) => listener(browserState()))
    tabListeners.forEach((listener) => listener(structuredClone(tabs)))
  }
  const selectTab = async (id: string) => {
    if (!tabs.some((tab) => tab.id === id)) return
    tabs = tabs.map((tab) => ({ ...tab, active: tab.id === id }))
    publishBrowser()
  }
  const openTab = async (url = 'about:blank') => {
    tabs.forEach((tab) => { tab.active = false })
    tabs.push({ id: `preview-tab-${++tabSequence}`, pos: tabs.length + 1, title: 'Sample browser tab',
      url, favicon: null, isLoading: false, active: true })
    publishBrowser()
    report('Browser chrome is simulated. Web content and native browser behavior require Electron.')
  }
  const removeTabs = async (keep: (tab: BrowserTabInfo) => boolean) => {
    tabs = tabs.filter(keep)
    if (!tabs.length) await openTab()
    if (!tabs.some((tab) => tab.active)) tabs[0]!.active = true
    publishBrowser()
  }
  // Onboarding fixture: Codex and the external CLIs absent, Claude bundled; matches the
  // `unavailable` scenario's missing-Codex message.
  const providerAvailability: ProviderAvailability[] = [
    { provider: 'codex', installed: false, path: null,
      hint: 'Codex is not installed. Install the Codex CLI and sign in from the app, or choose another model.' },
    { provider: 'claude', installed: true, path: null,
      hint: 'Claude Code is bundled with the app. Sign in from a Claude chat when prompted.' },
    { provider: 'antigravity', installed: false, path: null,
      hint: 'Antigravity is not installed. Install the Antigravity CLI (agy) and sign in with Google, or choose another model.' },
    { provider: 'cursor', installed: false, path: null,
      hint: 'Cursor is not installed. Install the Cursor CLI (cursor-agent) and run `cursor-agent login`, or choose another model.' }
  ]
  const api: ClosedaiApi = {
    chat: { ...chat.api, providerAvailability: async () => structuredClone(providerAvailability) },
    window: { minimize: native, maximize: native, toggleFullscreen: native, close: native, toggleDevTools: native },
    browser: {
      setBounds: async (bounds) => boundsChanged(bounds),
      navigate: async (url) => {
        const tab = tabs.find((entry) => entry.active)!
        tab.url = url
        publishBrowser()
        await native()
      },
      back: native, forward: native, reload: native, suggest: async () => null,
      searchHistory: async () => [], removeHistory: native,
      snapshot: async () => ({ state: browserState(), tabs: structuredClone(tabs) }),
      newTab: () => openTab(), newTabToRight: native, openTab, selectTab,
      closeTab: (id) => removeTabs((tab) => tab.id !== id),
      closeOtherTabs: (id) => removeTabs((tab) => tab.id === id),
      closeTabsToRight: async (id) => {
        const index = tabs.findIndex((tab) => tab.id === id)
        if (index >= 0) await removeTabs((tab) => tab.pos <= index + 1)
      },
      duplicateTab: async (id) => { const tab = tabs.find((entry) => entry.id === id); if (tab) await openTab(tab.url) },
      reloadTab: native,
      renameTab: async (id, title) => {
        const tab = tabs.find((entry) => entry.id === id)
        if (tab) { tab.customTitle = title; tab.title = title || 'Sample browser tab'; publishBrowser() }
      },
      capture: async () => null,
      onState: (listener) => { stateListeners.add(listener); return () => { stateListeners.delete(listener) } },
      onTabs: (listener) => { tabListeners.add(listener); return () => { tabListeners.delete(listener) } }
    },
    browserDownloads: { list: async () => [], pause: native, resume: native, cancel: native,
      reveal: native, clear: native, onChanged: idleSubscription },
    localFiles: { open: unavailable, openImage: unavailable, image: unavailable,
      revealImage: native, file: unavailable, revealFile: native },
    credentials: { status: async () => ({ encryptionAvailable: false, backend: 'UI preview — no vault', count: 0 }),
      list: async () => [], save: unavailable, reveal: unavailable, remove: native, rename: unavailable },
    researchLibrary: { snapshot: async () => structuredClone(library),
      progress: async () => ({ refreshing: false, lastRefresh: null }),
      configure: async (settings) => { library.settings = settings; return structuredClone(library) },
      refresh: async () => { await native(); return structuredClone(library) }, cancel: native,
      dismiss: async () => structuredClone(library), restore: async () => structuredClone(library) },
    tools: createToolsFixture(),
    trace: { setActive: async () => {}, snapshot: async () => ({ entries: [], dropped: 0, capacity: 0 }),
      clear: native, onEvent: idleSubscription }
  }
  return { api, start: chat.start, dispose: () => { chat.dispose(); stateListeners.clear(); tabListeners.clear() } }
}
