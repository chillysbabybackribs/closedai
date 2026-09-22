import type { ProjectPeersSnapshot } from '../../shared/project-peers.js'
import type { ChatStore } from '../chat-store/chat-store.js'
import { ensureProjectPeers } from '../project-peers/ensure-project-peers.js'
import type { PeerLifecycle } from './peer-lifecycle.js'
import type { DeferredProjectSwitch } from './deferred-project-switch.js'
import type { ChatPaneId } from '../../shared/chat-peers.js'

export function ensureWorkspaceProjectPeers(options: {
  projectSwitch: DeferredProjectSwitch
  store: ChatStore
  lifecycle: PeerLifecycle
  selectedPaneId: ChatPaneId
  backgroundPeers: Set<ChatPaneId>
  projectPath: string
  modelId: string | null
  reasoningEffort: string | null
}): ProjectPeersSnapshot {
  options.projectSwitch.assertAvailable()
  const { cwd } = options.store.require(options.selectedPaneId)
  return ensureProjectPeers({
    store: options.store,
    lifecycle: options.lifecycle,
    projectPath: options.projectPath,
    cwd,
    modelId: options.modelId,
    reasoningEffort: options.reasoningEffort,
    backgroundPeers: options.backgroundPeers
  })
}
