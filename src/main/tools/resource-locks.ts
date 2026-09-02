import type { JsonObject } from './tool.js'
import type { ToolCallRequest } from './registry.js'

type HeldResource = { paneId: string; callId: string }

export class ToolResourceLocks {
  private readonly held = new Map<string, HeldResource>()

  tryAcquire(request: ToolCallRequest, input: JsonObject, paneId: string | null, callId: string): (() => void) | string {
    const key = resourceKey(request, input)
    if (!key || !paneId) return () => {}
    const holder = this.held.get(key)
    if (holder && holder.callId !== callId) {
      return `${key} is busy in peer chat ${holder.paneId}; use another target or inspect it with peer_chats`
    }
    this.held.set(key, { paneId, callId })
    return () => {
      if (this.held.get(key)?.callId === callId) this.held.delete(key)
    }
  }
}

function resourceKey(request: ToolCallRequest, input: JsonObject): string | null {
  const action = typeof input.action === 'string' ? input.action : ''
  const tab = typeof input.tab_id === 'string' ? input.tab_id : 'active'
  if (request.namespace === 'closedai_app' && ['click', 'type', 'press_key', 'scroll'].includes(action)) {
    return 'ClosedAI app input'
  }
  if (request.namespace === 'embedded_browser' && action === 'navigate') return `browser tab ${tab}`
  if (
    request.namespace === 'browser_cdp' &&
    request.tool === 'page' &&
    ['click', 'click_at', 'type', 'press_key', 'scroll'].includes(action)
  ) {
    return `browser tab ${tab}`
  }
  return null
}
