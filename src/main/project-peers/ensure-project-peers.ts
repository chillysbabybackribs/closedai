import { chatProviderOfId } from '../../shared/chat-providers.js'
import { PROJECT_PEER_TITLES } from '../../shared/project-peer-ids.js'
import type { ProjectPeersSnapshot } from '../../shared/project-peers.js'
import type { ChatStore } from '../chat-store/chat-store.js'
import type { PeerLifecycle } from '../chat-peers/peer-lifecycle.js'
import { projectPeerChatId } from './project-peer-ids.js'

export function ensureProjectPeers(options: {
  store: ChatStore
  lifecycle: PeerLifecycle
  projectPath: string
  cwd: string
  modelId: string | null
  reasoningEffort: string | null
  backgroundPeers: Set<string>
}): ProjectPeersSnapshot {
  const { store, lifecycle, projectPath, cwd, modelId, reasoningEffort, backgroundPeers } = options
  const provider = chatProviderOfId(modelId)
  const roles = ['intake', 'coordinator'] as const
  const paneIds = { intakePaneId: '', coordinatorPaneId: '' }

  for (const role of roles) {
    const id = projectPeerChatId(projectPath, role)
    paneIds[role === 'intake' ? 'intakePaneId' : 'coordinatorPaneId'] = id
    backgroundPeers.add(id)
    let record = store.get(id)
    if (!record) {
      record = store.create({
        id,
        cwd,
        projectPath,
        provider,
        modelId,
        reasoningEffort,
        title: PROJECT_PEER_TITLES[role],
        titleSource: 'manual',
        pinnedAt: Date.now()
      })
    } else if (record.archived) {
      store.update(id, { archived: false, cwd, projectPath, modelId, reasoningEffort, provider })
    } else if (modelId && (record.modelId !== modelId || record.reasoningEffort !== reasoningEffort)) {
      store.update(id, { modelId, reasoningEffort, provider })
    }
    if (!lifecycle.get(id)) lifecycle.attach(record)
  }

  return { projectPath, intakePaneId: paneIds.intakePaneId, coordinatorPaneId: paneIds.coordinatorPaneId }
}
