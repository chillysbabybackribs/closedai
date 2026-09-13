import { join } from 'node:path'
import type { ChatStore } from '../chat-store/chat-store.js'
import type { ChatPeerManager } from '../chat-peers/peer-manager.js'
import { ArtifactStore } from './artifact-store.js'
import { ArtifactService } from './artifact-service.js'
import { investigationTools } from '../tools/investigation/index.js'

export function createArtifactRuntime(options: {
  root: string
  workerUrl: URL
  chats: ChatStore
  peers(): ChatPeerManager | null
}) {
  const store = new ArtifactStore(join(options.root, 'artifacts.sqlite'), { workerUrl: options.workerUrl })
  const service = new ArtifactService(store, (context) => {
    const record = context.paneId ? options.chats.get(context.paneId) : undefined
    const snapshot = context.paneId ? options.peers()?.paneSnapshot(context.paneId) : undefined
    if (!record || record.archived || !context.threadId || !context.turnId ||
        snapshot?.threadId !== context.threadId || snapshot.activeTurnId !== context.turnId) {
      throw new Error('Durable artifacts require the calling chat’s current active turn')
    }
    return { chatId: record.id, workspace: record.cwd }
  })
  return { store, service, namespace: investigationTools(service) }
}
