import type { ToolCallRequest } from '../registry.js'
import type { JsonObject, ToolContext } from '../tool.js'

type Tab = { id: string; active: boolean }
export type BrowserCoordinationHost = {
  tabs(): readonly Tab[]
  create(): string
  paneExists(paneId: string): boolean
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
    if (namespace === 'embedded_browser' && tool === 'session') {
      if (['set_cookie', 'remove_cookie'].includes(action) ||
          (action === 'fetch' && !['GET', 'HEAD'].includes(String(input.method ?? 'GET')))) this.exclusiveSession(pane)
      return input
    }
    if (namespace === 'embedded_browser' && tool === 'network') {
      if (action === 'add_rule' && typeof input.tab_id === 'string') this.claim(input.tab_id, pane)
      else if (['add_rule', 'remove_rule', 'clear'].includes(action)) this.exclusiveSession(pane)
      return input
    }
    if (namespace === 'closedai_app' && tool === 'ui' && ['click', 'type', 'press_key', 'scroll'].includes(action)) {
      // Renderer controls can switch/close arbitrary tabs; use addressed browser commands instead.
      this.exclusiveSession(pane)
      return input
    }
    const tabCommand = namespace === 'closedai_app' && tool === 'command' && action === 'browser_tab'
    const pageTool = namespace === 'embedded_browser' && ['page', 'script'].includes(tool)
    const capture = namespace === 'closedai_ui' && tool === 'capture' && action === 'browser_page'
    if (!tabCommand && !pageTool && !capture && namespace !== 'browser_cdp') return input
    if (namespace === 'browser_cdp' && tool === 'protocol') this.checkProtocol(input, pane)
    if (tabCommand && input.op === 'new') return input
    if (tabCommand && input.op === 'release') return input
    if (pageTool && tool === 'page' && action === 'navigate') {
      if (input.new_tab === true && input.tab_id) throw new Error('navigate cannot combine tab_id with new_tab')
      if (input.new_tab === true || (!input.tab_id && !this.defaults.has(pane))) {
        const id = this.host.create()
        this.claim(id, pane)
        return { ...input, new_tab: false, tab_id: id }
      }
    }
    const id = typeof input.tab_id === 'string' ? input.tab_id
      : this.defaults.get(pane) ?? this.host.tabs().find(tab => tab.active)?.id
    if (!id || !this.host.tabs().some(tab => tab.id === id)) {
      throw new Error('This chat’s browser tab is closed or unavailable. Pass an open tab_id or navigate with new_tab: true; the selected tab was not used.')
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

  snapshot(paneId?: string | null): { defaultTabId: string | null; assignments: Array<{ tabId: string; paneId: string }> } {
    this.prune()
    return { defaultTabId: paneId ? this.defaults.get(paneId) ?? null : null,
      assignments: [...this.owners].map(([tabId, owner]) => ({ tabId, paneId: owner })) }
  }

  private checkOwner(tabId: string, paneId: string): void {
    const owner = this.owners.get(tabId)
    if (owner && owner !== paneId) {
      throw new Error(`Browser tab ${tabId} is assigned to chat ${owner}. Use your own tab or navigate with new_tab: true. Its owner can release it with browser_tab op: release.`)
    }
  }

  private exclusiveSession(pane: string): void {
    if ([...this.owners.values()].some(owner => owner !== pane)) {
      throw new Error('Shared browser session or app-wide input is in use by another chat. Use tab-scoped browser tools; session-wide changes require other chats to release their tabs.')
    }
  }

  private checkProtocol(input: JsonObject, pane: string): void {
    const method = String(input.method ?? '')
    // Raw Target commands can address another root through the caller’s debugger connection.
    // They remain available exclusively; addressed app commands also work alongside peers.
    if (input.action === 'target' || (method.startsWith('Target.') && !['Target.getTargets', 'Target.getTargetInfo'].includes(method))) {
      this.exclusiveSession(pane)
    }
    if ((/^(Browser|Storage)\./.test(method) && !/\.(get|can)/.test(method)) ||
        /^Network\.(setCookie|setCookies|deleteCookies|clearBrowserCookies|clearBrowserCache)$/.test(method)) this.exclusiveSession(pane)
  }

  private prune(): void {
    const tabs = new Set(this.host.tabs().map(tab => tab.id))
    for (const [id, owner] of this.owners) if (!tabs.has(id) || !this.host.paneExists(owner)) this.owners.delete(id)
    // Keep closed-tab defaults as tombstones: never silently retarget to another page.
    for (const pane of this.defaults.keys()) if (!this.host.paneExists(pane)) this.defaults.delete(pane)
  }
}
