import type { ChatWorkspaceSnapshot } from '../../shared/chat-peers.js'

/** Bumps when layout chrome must react; stable while only drawer previews or transcript text change. */
export function chatLayoutRevision(snapshot: ChatWorkspaceSnapshot): string {
  const ids = snapshot.chats.map((chat) => chat.paneId)
  ids.sort()
  const cwd = snapshot.workspace?.cwd ?? snapshot.selected.cwd
  return `${snapshot.selectedPaneId}\0${cwd}\0${ids.join('\0')}`
}
