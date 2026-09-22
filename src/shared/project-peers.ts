import type { ChatPaneId } from './chat-peers.js'

export type ProjectPeersSnapshot = {
  projectPath: string
  intakePaneId: ChatPaneId
  coordinatorPaneId: ChatPaneId
}
