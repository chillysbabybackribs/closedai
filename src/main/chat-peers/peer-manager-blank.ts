import type { ChatPaneId } from '../../shared/chat-peers.js'
import { isProjectPeerChatId } from '../../shared/project-peer-ids.js'
import type { PeerLifecycle } from './peer-lifecycle.js'

/** Background project peers and visible tabs stay attached even when blank. */
export function retainBlankPeer(paneId: ChatPaneId, options: {
  peerCount: number
  visiblePaneIds: ReadonlySet<ChatPaneId>
  retainedTabIds: ReadonlySet<ChatPaneId>
}): boolean {
  if (options.peerCount <= 1) return true
  if (options.visiblePaneIds.has(paneId) || options.retainedTabIds.has(paneId)) return true
  return isProjectPeerChatId(paneId)
}

export function discardHiddenBlankIfAllowed(lifecycle: PeerLifecycle, paneId: ChatPaneId, options: {
  peerCount: number
  visiblePaneIds: ReadonlySet<ChatPaneId>
  retainedTabIds: ReadonlySet<ChatPaneId>
}): void {
  if (retainBlankPeer(paneId, options)) return
  lifecycle.discardIfBlank(paneId)
}
