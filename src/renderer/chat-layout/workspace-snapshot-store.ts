import type { ChatSnapshot } from '../../shared/chat.js'
import type { ChatWorkspaceSnapshot } from '../../shared/chat-peers.js'

let snapshot: ChatWorkspaceSnapshot | null = null
const listeners = new Set<() => void>()

export function setWorkspaceSnapshot(next: ChatWorkspaceSnapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

export function getWorkspaceSnapshot(): ChatWorkspaceSnapshot {
  if (!snapshot) throw new Error('Workspace snapshot store is not initialized')
  return snapshot
}

export function subscribeWorkspaceSnapshot(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function paneChatSnapshot(workspace: ChatWorkspaceSnapshot, paneId: string): ChatSnapshot | undefined {
  return workspace.panes?.[paneId] ?? (workspace.selectedPaneId === paneId ? workspace.selected : undefined)
}

export type WorkspacePaneSlice = {
  state: ChatSnapshot | undefined
  chats: ChatWorkspaceSnapshot['chats']
  selectedPaneId: string
  workspace: ChatWorkspaceSnapshot['workspace']
  preferences: ChatWorkspaceSnapshot['preferences']
}

export function workspacePaneSlice(workspace: ChatWorkspaceSnapshot, paneId: string): WorkspacePaneSlice {
  return {
    state: paneChatSnapshot(workspace, paneId),
    chats: workspace.chats,
    selectedPaneId: workspace.selectedPaneId,
    workspace: workspace.workspace,
    preferences: workspace.preferences
  }
}

export function workspacePaneSliceEqual(previous: WorkspacePaneSlice, next: WorkspacePaneSlice): boolean {
  return previous.state === next.state && previous.chats === next.chats
    && previous.selectedPaneId === next.selectedPaneId && previous.preferences === next.preferences
    && previous.workspace === next.workspace
}
