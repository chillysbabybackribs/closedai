import type { ClosedaiApi } from '../../shared/api.js'
import { createDefaultProjectStoreFile } from '../../shared/project/store-file.js'
import type { ProjectSnapshot } from '../../shared/project/snapshot.js'
import type { BrowserBounds, BrowserState, BrowserTabInfo } from '../../shared/types.js'
import type { LibrarySnapshot } from '../../shared/research-library.js'
import type { ProviderAvailability } from '../../shared/provider-availability.js'
import type { CredentialSummary } from '../../shared/credentials.js'
import { DEFAULT_SECURITY_SETTINGS, normalizeSecuritySettings, type SecuritySettings } from '../../shared/security.js'
import { createPreviewChat } from './chat.js'
import { sampleSecurityRequests, type Scenario } from './fixtures.js'
import { createModelsFixture } from './models-fixture.js'
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
  // Settings → Security: the preview holds the defaults in memory and reports the native-only import.
  let security: SecuritySettings = { ...DEFAULT_SECURITY_SETTINGS }
  const credentials: CredentialSummary[] = []
  // Opt-in prompt surfaces: only the `security` scenario seeds pending requests; a decision drops
  // the request and republishes, as main does once the user answers.
  const pending = sampleSecurityRequests(scenario)
  const approvalListeners = new Set<(items: typeof pending.credentials) => void>()
  const permissionListeners = new Set<(items: typeof pending.permissions) => void>()
  const projectSnapshots = new Map<string, ProjectSnapshot>()
  const projectListeners = new Set<(event: import('../../shared/project/events.js').ProjectWorkspaceEvent) => void>()
  const projectSnapshot = (projectPath: string): ProjectSnapshot => {
    const existing = projectSnapshots.get(projectPath)
    if (existing) return structuredClone(existing)
    const created = { projectPath, ...createDefaultProjectStoreFile() }
    projectSnapshots.set(projectPath, created)
    return structuredClone(created)
  }
  const publishSecurity = () => {
    approvalListeners.forEach((listener) => listener(structuredClone(pending.credentials)))
    permissionListeners.forEach((listener) => listener(structuredClone(pending.permissions)))
  }
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
      resolvePermission: async (id) => { pending.permissions = pending.permissions.filter((entry) => entry.id !== id); publishSecurity() },
      onState: (listener) => { stateListeners.add(listener); return () => { stateListeners.delete(listener) } },
      onTabs: (listener) => { tabListeners.add(listener); return () => { tabListeners.delete(listener) } },
      onPermissionRequests: (listener) => {
        permissionListeners.add(listener); listener(structuredClone(pending.permissions))
        return () => { permissionListeners.delete(listener) }
      }
    },
    browserDownloads: { list: async () => [], pause: native, resume: native, cancel: native,
      reveal: native, clear: native, onChanged: idleSubscription },
    localFiles: { open: unavailable, openImage: unavailable, image: unavailable,
      revealImage: native, file: unavailable, revealFile: native },
    credentials: { status: async () => ({ encryptionAvailable: false, backend: 'UI preview — no vault', count: 0 }),
      list: async () => structuredClone(credentials), save: unavailable, reveal: unavailable, remove: native, rename: unavailable,
      setAgentAccess: async (id, allowed) => {
        const entry = credentials.find((candidate) => candidate.id === id)
        if (!entry) throw new Error('Credential not found')
        entry.agentAccess = allowed
        return structuredClone(entry)
      } },
    security: { get: async () => ({ ...security }),
      set: async (patch) => { security = normalizeSecuritySettings({ ...security, ...patch }); return { ...security } },
      importCookies: async () => { await native(); return { source: null, imported: 0, failed: 0, skipped: 0 } },
      resolveCredentialApproval: async (id) => { pending.credentials = pending.credentials.filter((entry) => entry.id !== id); publishSecurity() },
      onCredentialApprovals: (listener) => {
        approvalListeners.add(listener); listener(structuredClone(pending.credentials))
        return () => { approvalListeners.delete(listener) }
      } },
    researchLibrary: { snapshot: async () => structuredClone(library),
      progress: async () => ({ refreshing: false, lastRefresh: null }),
      configure: async (settings) => { library.settings = settings; return structuredClone(library) },
      refresh: async () => { await native(); return structuredClone(library) }, cancel: native,
      dismiss: async () => structuredClone(library), restore: async () => structuredClone(library) },
    tools: createToolsFixture(),
    models: createModelsFixture(),
    trace: { setActive: async () => {}, snapshot: async () => ({ entries: [], dropped: 0, capacity: 0 }),
      clear: native, onEvent: idleSubscription },
    project: {
      snapshot: async (projectPath: string) => projectSnapshot(projectPath),
      ensurePeers: async () => { throw new Error('Project peers are not available in preview') },
      onEvent: (listener) => {
        projectListeners.add(listener)
        return () => { projectListeners.delete(listener) }
      }
    }
  }
  return { api, start: chat.start, dispose: () => { chat.dispose(); stateListeners.clear(); tabListeners.clear(); projectListeners.clear() } }
}
