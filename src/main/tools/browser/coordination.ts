import type { ToolCallRequest } from '../registry.js'
import type { JsonObject, ToolContext } from '../tool.js'
import { isBrowserObservingCall } from './tool-surface.js'

type Tab = { id: string; active: boolean }
export type BrowserCoordinationHost = {
  tabs(): readonly Tab[]
  create(): string
  paneExists(paneId: string): boolean
  /** Whether the pane is running a turn or live background work; idle assignments stay on tabs but do not block session-wide tools. */
  paneRunning(paneId: string): boolean
}

/** App-session assignments survive turns and focus changes, but never a detached chat. */
export class BrowserCoordination {
  private readonly owners = new Map<string, string>()
  private readonly defaults = new Map<string, string>()

  constructor(private readonly host: BrowserCoordinationHost) {}

  prepare(request: ToolCallRequest, original: JsonObject, context: Pick<ToolContext, 'paneId' | 'source'>): JsonObject {
    const pane = context.paneId
    if (!pane) {
      const browserCall = ['embedded_browser', 'browser_cdp'].includes(request.namespace ?? '') ||
        (request.namespace === 'closedai_ui' && original.action === 'browser_page') ||
        (request.namespace === 'closedai_app' && (original.action === 'browser_tab' ||
          (request.tool === 'ui' && ['click', 'type', 'press_key', 'scroll'].includes(String(original.action)))))
      if (browserCall && context.source !== 'system') throw new Error('Browser tools require an identified calling chat; UI selection is not caller identity.')
      return original
    }
    this.prune()
    const input = { ...original }
    const { namespace, tool } = request
    const action = String(input.action ?? '')
    if (namespace === 'embedded_browser' && tool === 'network' && action === 'add_rule' && typeof input.tab_id === 'string') {
      this.claim(input.tab_id, pane)
    }
    const tabCommand = namespace === 'closedai_app' && tool === 'command' && action === 'browser_tab'
    const pageTool = namespace === 'embedded_browser' && ['page', 'script'].includes(tool)
    const capture = namespace === 'closedai_ui' && tool === 'capture' && action === 'browser_page'
    if (!tabCommand && !pageTool && !capture && namespace !== 'browser_cdp') return input
    if (tabCommand && (input.op === 'new' || input.op === 'preview_html')) return input
    if (tabCommand && ['release', 'release_all', 'claim'].includes(String(input.op))) return input
    if (pageTool && tool === 'page' && action === 'navigate') {
      if (input.new_tab === true && input.tab_id) throw new Error('navigate cannot combine tab_id with new_tab')
      if (input.new_tab === true || (!input.tab_id && !this.defaults.has(pane))) {
        const id = this.host.create()
        this.claim(id, pane)
        return { ...input, new_tab: false, tab_id: id }
      }
    }
    if (namespace === 'browser_cdp' && tool === 'capture_spa') {
      if (input.new_tab === true && input.tab_id) throw new Error('capture_spa cannot combine tab_id with new_tab')
      if (input.new_tab === true || (!input.tab_id && !this.defaults.has(pane))) {
        const id = this.host.create()
        this.claim(id, pane)
        return { ...input, new_tab: false, tab_id: id }
      }
    }
    const ownedDefault = this.defaults.get(pane)
    const id = typeof input.tab_id === 'string' ? input.tab_id
      : ownedDefault ?? this.host.tabs().find(tab => tab.active)?.id
    if (!id || !this.host.tabs().some(tab => tab.id === id)) {
      throw new Error('This chat’s browser tab is closed or unavailable. Pass an open tab_id or navigate with new_tab: true; the selected tab was not used.')
    }
    const observing = this.observes(request, action, input, tabCommand)
    if (!observing && typeof input.tab_id !== 'string' && !ownedDefault) {
      throw new Error('This chat has no assigned tab yet. Open your own tab first (navigate with new_tab: true, or browser_tab new/new_right) before acting in a page; the visible tab is for reads, not default mutations.')
    }
    // Reading any tab is allowed and claims nothing; selecting one only changes what the window
    // shows. Both leave the page to whoever is working in it. Reading one this chat already owns
    // does point its default there, so "read that tab, now act in it" stays one conversation:
    // that moves nothing between chats, because the tab was already this one's.
    if (observing) {
      if (this.owners.get(id) === pane) this.defaults.set(pane, id)
      return { ...input, tab_id: id }
    }
    if (tabCommand && ['close_others', 'close_right'].includes(String(input.op))) {
      const tabs = this.host.tabs()
      const affected = input.op === 'close_others' ? tabs.filter(tab => tab.id !== id)
        : tabs.slice(tabs.findIndex(tab => tab.id === id) + 1)
      for (const tab of affected) this.checkOwner(tab.id, pane)
    }
    this.claim(id, pane)
    return { ...input, tab_id: id }
  }

  claim(tabId: string, paneId: string): void {
    this.prune()
    this.checkOwner(tabId, paneId)
    this.owners.set(tabId, paneId)
    this.defaults.set(paneId, tabId)
  }

  inherit(openerTabId: string, childTabId: string): void {
    this.prune()
    const owner = this.owners.get(openerTabId)
    if (owner) this.owners.set(childTabId, owner)
  }

  canUse(tabId: string, paneId: string): boolean {
    this.prune()
    const owner = this.owners.get(tabId)
    return !owner || owner === paneId
  }

  release(tabId: string | undefined, paneId: string): void {
    this.prune()
    const id = tabId ?? this.defaults.get(paneId)
    if (!id) return
    this.checkOwner(id, paneId)
    this.owners.delete(id)
    if (this.defaults.get(paneId) === id) this.defaults.delete(paneId)
  }

  /** Drop every tab assignment for one chat without closing tabs. */
  releaseAll(paneId: string): number {
    this.prune()
    let released = 0
    for (const [tabId, owner] of [...this.owners.entries()]) {
      if (owner !== paneId) continue
      this.owners.delete(tabId)
      released++
    }
    this.defaults.delete(paneId)
    return released
  }

  snapshot(paneId?: string | null): {
    defaultTabId: string | null; assignmentCount: number; omittedAssignments: number
    assignments: Array<{ tabId: string; paneId: string; paneRunning: boolean }>
  } {
    this.prune()
    const defaultTabId = paneId ? this.defaults.get(paneId) ?? null : null
    const rank = ([id, owner]: [string, string]) => (id === defaultTabId ? 2 : owner === paneId ? 1 : 0)
    const entries = [...this.owners].sort((a, b) => rank(b) - rank(a))
    return { defaultTabId, assignmentCount: entries.length, omittedAssignments: Math.max(0, entries.length - 32),
      assignments: entries.slice(0, 32).map(([tabId, owner]) => ({
        tabId, paneId: owner, paneRunning: this.host.paneRunning(owner)
      })) }
  }

  /** Whether this call only looks at the tab, so it needs no assignment and takes none. */
  private observes(request: ToolCallRequest, action: string, input: JsonObject, tabCommand: boolean): boolean {
    if (tabCommand) return input.op === 'select'
    return isBrowserObservingCall(request, { ...input, action })
  }

  private checkOwner(tabId: string, paneId: string): void {
    const owner = this.owners.get(tabId)
    if (owner && owner !== paneId) {
      throw new Error(`Browser tab ${tabId} is assigned to chat ${owner}. You can still read it (read_page, wait_for, query, extract, console, capture) and select it; to act in a page, use your own tab or navigate with new_tab: true. Its owner can release it with browser_tab op: release.`)
    }
  }

  private prune(): void {
    const tabs = new Set(this.host.tabs().map(tab => tab.id))
    for (const [id, owner] of this.owners) if (!tabs.has(id) || !this.host.paneExists(owner)) this.owners.delete(id)
    // Keep closed-tab defaults as tombstones: never silently retarget to another page.
    for (const pane of this.defaults.keys()) if (!this.host.paneExists(pane)) this.defaults.delete(pane)
  }
}
