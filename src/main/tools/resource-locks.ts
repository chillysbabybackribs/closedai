import type { JsonObject } from './tool.js'
import type { ToolCallRequest } from './registry.js'

type HeldResource = { paneId: string; callId: string }

export class ToolResourceLocks {
  private readonly held = new Map<string, HeldResource>()

  tryAcquire(request: ToolCallRequest, input: JsonObject, paneId: string | null, callId: string): (() => void) | string {
    const key = resourceKey(request, input)
    if (!key || !paneId) return () => {}
    const holder = [...this.held.entries()].find(([heldKey]) => resourcesConflict(key, heldKey))?.[1]
    if (holder) {
      return `${describeResource(key)} is busy in peer chat ${holder.paneId}; use another target or inspect it with peer_chats`
    }
    const entry = { paneId, callId }
    this.held.set(key, entry)
    return () => {
      if (this.held.get(key) === entry) this.held.delete(key)
    }
  }
}

/** Shared browser-target identity for both per-call locking and batch scheduling. */
export function resourceKey(request: ToolCallRequest, input: JsonObject): string | null {
  const action = typeof input.action === 'string' ? input.action : ''
  const browserTarget = () => {
    const tab = typeof input.tab_id === 'string' && input.tab_id.length > 0 ? input.tab_id : null
    return tab ? `browser:tab:${tab}` : 'browser:global'
  }
  if (request.namespace === 'closedai_app' && request.tool === 'ui' && ['click', 'type', 'press_key', 'scroll'].includes(action)) {
    return 'browser:global'
  }
  if (request.namespace === 'embedded_browser') {
    if (['page', 'script'].includes(request.tool)) return input.new_tab === true ? 'browser:global' : browserTarget()
    if (request.tool === 'session') return 'browser:global'
    if (request.tool === 'network' && ['add_rule', 'remove_rule', 'clear'].includes(action)) return 'browser:global'
  }
  if (request.namespace === 'closedai_app' && request.tool === 'command' && action === 'browser_tab') return 'browser:global'
  if (request.namespace === 'closedai_ui' && request.tool === 'capture' && action === 'browser_page') return browserTarget()
  if (request.namespace === 'browser_cdp') {
    // Trusted input activates tabs. Different tab ids still share one foreground surface.
    if (request.tool === 'page' && ['click', 'click_at', 'type', 'press_key', 'scroll', 'dismiss_overlay'].includes(action)) return 'browser:global'
    if (request.tool === 'protocol' && (action === 'target' ||
        (action === 'command' && /^(Input|Target|Browser|Storage)\.|^Network\.(setCookie|setCookies|deleteCookies|clearBrowser)/.test(String(input.method))))) return 'browser:global'
    return browserTarget()
  }
  return null
}

function resourcesConflict(left: string, right: string): boolean {
  if (left === right) return true
  return (left === 'browser:global' && right.startsWith('browser:tab:')) ||
    (right === 'browser:global' && left.startsWith('browser:tab:'))
}

function describeResource(key: string): string {
  if (key === 'browser:global') return 'the active browser or tab strip'
  if (key.startsWith('browser:tab:')) return `browser tab ${key.slice('browser:tab:'.length)}`
  if (key === 'app:input') return 'ClosedAI app input'
  return key
}
