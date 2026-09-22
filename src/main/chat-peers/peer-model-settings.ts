import type { ChatHub } from '../chat-hub.js'
import type { ChatPaneId } from '../../shared/chat-peers.js'
import type { PeerLifecycle } from './peer-lifecycle.js'

export function selectedHub(lifecycle: PeerLifecycle, selectedPaneId: ChatPaneId): ChatHub | null {
  const surface = lifecycle.get(selectedPaneId)?.surface
  return surface && 'providerSnapshot' in surface ? surface as ChatHub : null
}

export function refreshModelPicker(lifecycle: PeerLifecycle): void {
  for (const entry of lifecycle.peers.values()) {
    const surface = entry.surface
    if ('refreshModelPicker' in surface && typeof surface.refreshModelPicker === 'function') surface.refreshModelPicker()
  }
}
