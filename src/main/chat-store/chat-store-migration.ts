import type { AppSettings, ChatWorkspaceRecord } from '../../shared/types.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import { chatRecordFromPeer } from './chat-record.js'
import type { ChatStore } from './chat-store.js'

// One-shot import of the pane records settings used to hold — the active workspace's
// `chatPeers` and every saved workspace's `peers` — into the chat store. Ids are kept, so the
// drawer's completion marks and per-pane checkpoints keep pointing at the same chats. Settings
// end up naming which chats are open (`chatOpenIds`, `openIds`) and nothing else about them.

export type ChatStoreMigrationResult = {
  imported: number
  settings: AppSettings
}

export async function migrateChatPeersIntoStore(
  settings: AppSettingsAccess,
  store: ChatStore,
  active: { cwd: string; projectPath: string | null }
): Promise<ChatStoreMigrationResult> {
  const current = settings.get()
  let imported = 0
  const importPeers = (peers: AppSettings['chatPeers'], cwd: string, projectPath: string | null): string[] => {
    const ids: string[] = []
    for (const peer of peers) {
      if (!store.has(peer.paneId)) {
        store.create(chatRecordFromPeer(peer, cwd, projectPath))
        imported += 1
      }
      ids.push(peer.paneId)
    }
    return ids
  }

  const activeIds = current.chatPeers.length > 0
    ? importPeers(current.chatPeers, active.cwd, active.projectPath)
    : current.chatOpenIds
  const workspaces: ChatWorkspaceRecord[] = current.chatWorkspaces.map((workspace) => {
    const openIds = workspace.peers.length > 0
      ? importPeers(workspace.peers, workspace.cwd, workspace.projectPath)
      : workspace.openIds
    return { ...workspace, openIds, peers: [] }
  })
  const changed = imported > 0 ||
    current.chatPeers.length > 0 ||
    current.chatWorkspaces.some((workspace) => workspace.peers.length > 0) ||
    activeIds !== current.chatOpenIds
  if (!changed) return { imported, settings: current }
  const updated = await settings.set({
    chatOpenIds: activeIds.filter((id) => store.has(id)),
    chatPeers: [],
    chatWorkspaces: workspaces,
    chatSelectedPaneId: activeIds.includes(current.chatSelectedPaneId ?? '') ? current.chatSelectedPaneId : activeIds[0] ?? null
  })
  return { imported, settings: updated }
}
