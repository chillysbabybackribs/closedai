import type { ChatSnapshot, ChatThreadSummary } from '../../shared/chat.js'
import { chatProviderOfId } from '../../shared/chat-providers.js'
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
 *
 * A pane that has not been woken since relaunch reports no items; its name then comes from the
 * persisted record (via the peer summary) or, failing that, from the thread catalog.
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
  const catalogTitles = new Map(threads.map((thread) => [thread.id, thread.title]))

  for (const peer of peers) {
    const isSelected = peer.paneId === selectedPaneId
    const threadId = (isSelected ? selected.threadId : null) ?? peer.threadId
    if (threadId) seenThreads.add(threadId)
    const running = isSelected ? selected.activeTurnId !== null : peer.running
    // An idle pane with any conversation behind it has finished a turn; only a blank pane is
    // a plain "chat". The last item's kind used to decide this, which flipped the dot between
    // green and hollow depending on whether a tool call happened to be the final item.
    const hasConversation = threadId !== null || peer.preview !== ''
    const status: DrawerRowStatus = running ? 'running' : hasConversation ? 'done' : 'chat'
    peerRows.set(peer.paneId, {
      id: peer.paneId,
      threadId,
      paneId: peer.paneId,
      title: paneRowTitle(peer, isSelected ? selected.threadName : null, threadId, catalogTitles),
      cwd: selected.cwd || null,
      updatedAt: peer.updatedAt,
      messageCount: isSelected ? selected.items.filter((item) => item.type === 'user').length : 0,
      linesAdded: isSelected ? selectedDiff.added : 0,
      linesRemoved: isSelected ? selectedDiff.removed : 0,
      running,
      status,
      provider: isSelected ? selected.provider : peer.provider,
      peer,
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
      // A history record has no runtime to ask, but its id names its provider: Codex thread ids
      // carry no prefix, so a Codex chat used to be the one row in History with no mark at all.
      provider: chatProviderOfId(thread.id),
      thread,
      children: []
    })
  }

  return rows
}

const PLACEHOLDER_TITLES = new Set(['', 'New chat', 'Peer chat', 'Active chat'])

/** The live name wins; a cold pane's placeholder defers to the thread catalog's title. */
function paneRowTitle(
  peer: ChatPeerSummary,
  selectedThreadName: string | null,
  threadId: string | null,
  catalogTitles: Map<string, string>
): string {
  if (selectedThreadName) return selectedThreadName
  if (!PLACEHOLDER_TITLES.has(peer.title)) return peer.title
  const fromCatalog = threadId ? catalogTitles.get(threadId) : undefined
  if (fromCatalog && !PLACEHOLDER_TITLES.has(fromCatalog)) return fromCatalog
  return peer.title || (peer.kind === 'subagent' ? 'Subagent task' : 'New chat')
}
