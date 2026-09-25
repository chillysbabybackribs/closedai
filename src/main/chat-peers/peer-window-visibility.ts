import type { ChatPaneId } from '../../shared/chat-peers.js'

/**
 * Each app window reports the chats its tiles show and the chat tabs it holds; the workspace acts
 * on their union. One window's report replaces only its own entry, so a detached window never
 * hides the main window's chats (or the reverse) by reporting its own.
 */
export class PeerWindowVisibility {
  private readonly windows = new Map<string, { visible: ChatPaneId[]; retained: ChatPaneId[] }>()

  set(windowId: string, visible: ChatPaneId[], retained: ChatPaneId[]): void {
    this.windows.set(windowId, { visible: [...visible], retained: [...retained] })
  }

  /** False when the window had reported nothing. */
  release(windowId: string): boolean {
    return this.windows.delete(windowId)
  }

  clear(): void {
    this.windows.clear()
  }

  visible(): Set<ChatPaneId> {
    return new Set([...this.windows.values()].flatMap((entry) => entry.visible))
  }

  retained(): Set<ChatPaneId> {
    return new Set([...this.windows.values()].flatMap((entry) => entry.retained))
  }
}
