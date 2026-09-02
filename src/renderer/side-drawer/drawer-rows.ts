import type { ChatSnapshot, ChatThreadSummary } from '../../shared/chat.js'
import type { ChatPeerSummary } from '../../shared/chat-peers.js'
import type { DrawerRowModel, DrawerRowStatus } from './drawer-types.js'

type SelectedDiff = {
  added: number
  removed: number
}

type DrawerRowsInput = {
  selected: ChatSnapshot
  selectedPaneId: string
  peers: ChatPeerSummary[]
  threads: ChatThreadSummary[]
  selectedDiff: SelectedDiff
}

/**
 * Build live pane rows without making selection part of their identity or position.
 * Peer manager order is creation order, so prepending each root keeps the newest pane at the top
 * and lets a new pane push existing rows down without clicks ever promoting a row.
 */
export function buildDrawerRows({
  selected,
  selectedPaneId,
  peers,
  threads,
  selectedDiff
}: DrawerRowsInput): DrawerRowModel[] {
  const rows: DrawerRowModel[] = []
  const seenThreads = new Set<string>()
  const peerRows = new Map<string, DrawerRowModel>()

  for (const peer of peers) {
    const isSelected = peer.paneId === selectedPaneId
    const threadId = isSelected ? selected.threadId : peer.threadId
    if (threadId) seenThreads.add(threadId)
    const running = isSelected ? selected.activeTurnId !== null : peer.running
    const status: DrawerRowStatus = running ? 'running' : (peer.activity ? 'done' : 'chat')
    peerRows.set(peer.paneId, {
      id: peer.paneId,
      threadId,
      paneId: peer.paneId,
      title: isSelected
        ? selected.threadName || peer.title || 'Active chat'
        : peer.title || (peer.kind === 'subagent' ? 'Subagent task' : 'Peer chat'),
      cwd: selected.cwd || null,
      updatedAt: peer.updatedAt,
      messageCount: isSelected ? selected.items.filter((item) => item.type === 'user').length : 0,
      linesAdded: isSelected ? selectedDiff.added : 0,
      linesRemoved: isSelected ? selectedDiff.removed : 0,
      running,
      status,
      provider: isSelected ? selected.provider : peer.provider,
      peer,
      completedUnviewed: false,
      children: []
    })
  }

  for (const peer of peers) {
    const row = peerRows.get(peer.paneId)!
    if (peer.parentPaneId && peerRows.has(peer.parentPaneId)) {
      peerRows.get(peer.parentPaneId)!.children.unshift(row)
    } else {
      rows.unshift(row)
    }
  }

  for (const thread of threads) {
    if (seenThreads.has(thread.id)) continue
    rows.push({
      id: thread.id,
      threadId: thread.id,
      title: thread.title,
      cwd: selected.cwd || null,
      updatedAt: thread.updatedAt,
      messageCount: 1,
      linesAdded: 0,
      linesRemoved: 0,
      running: false,
      status: 'chat',
      thread,
      completedUnviewed: false,
      children: []
    })
  }

  return rows
}
