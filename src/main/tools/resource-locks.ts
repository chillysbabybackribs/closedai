import type { JsonObject } from './tool.js'
import type { ToolCallRequest } from './registry.js'
import {
  browserResourceLockKey,
  browserResourceLocksConflict,
  describeBrowserResource
} from './browser/tool-surface.js'

type HeldResource = { paneId: string; callId: string }

export class ToolResourceLocks {
  private readonly held = new Map<string, HeldResource>()

  tryAcquire(request: ToolCallRequest, input: JsonObject, paneId: string | null, callId: string): (() => void) | string {
    const key = resourceKey(request, input)
    if (!key || !paneId) return () => {}
    const holder = [...this.held.entries()].find(([heldKey]) => browserResourceLocksConflict(key, heldKey))?.[1]
    if (holder) {
      const who = holder.paneId === paneId ? 'this chat (wait for the in-flight call to finish)' : `chat ${holder.paneId}`
      return `${describeBrowserResource(key)} is busy in ${who}; use another tab or inspect peer_chats`
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
  return browserResourceLockKey(request, input)
}
