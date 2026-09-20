import type { ChatSnapshot, ChatTranscriptItem } from '../../shared/chat.js'
import { isInjectedContextTitle, sanitizeThreadTitle } from '../../shared/chat-display.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { DrawerRowModel, DrawerRowStatus } from './drawer-types.js'

type SelectedDiff = {
  added: number
  removed: number
}

type DrawerRowsInput = {
  selected: ChatSnapshot
  selectedPaneId: string
  chats: ChatRowSummary[]
  selectedDiff: SelectedDiff
}

const PLACEHOLDER_TITLES = new Set(['', 'New chat', 'Peer chat', 'Active chat'])

function latestLiveActivity(items: readonly ChatTranscriptItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]!
    if (item.type === 'tool') return item.label
    if (item.type === 'command') return 'Run command'
    if (item.type === 'fileChange') return 'Edit file'
  }
  return null
}

/**
 * One row per chat record, straight from the workspace's `chats`. Every fact that moves a row —
 * running, title, activity time — comes from that one list, whether or not the chat is attached
 * or selected. The selected pane's live snapshot only adds detail the list does not carry (its
 * thread name, message count, and diff), never a different answer to the same question: the old
 * split between "selected pane reads its own turn" and "other panes read the summary" is what
 * let a chat show as running in one place and finished in another.
 */
export function buildDrawerRows({
  selected,
  selectedPaneId,
  chats,
  selectedDiff
}: DrawerRowsInput): DrawerRowModel[] {
  const rows: DrawerRowModel[] = []
  const byId = new Map<string, DrawerRowModel>()

  for (const chat of chats) {
    const isSelected = chat.paneId === selectedPaneId
    const threadId = (isSelected ? selected.threadId : null) ?? chat.threadId
    // An idle chat with any conversation behind it has finished a turn; only a blank chat is a
    // plain "chat". The last item's kind used to decide this, which flipped the dot between
    // green and hollow depending on whether a tool call happened to be the final item.
    const hasConversation = threadId !== null || chat.preview !== ''
    const status: DrawerRowStatus = chat.running ? 'running' : hasConversation ? 'done' : 'chat'
    const activity = chat.activity ?? (isSelected ? latestLiveActivity(selected.items) : null)
    byId.set(chat.paneId, {
      id: chat.paneId,
      threadId,
      ...(chat.attached ? { paneId: chat.paneId } : {}),
      title: rowTitle(chat, isSelected ? selected.threadName : null),
      cwd: chat.cwd || selected.cwd || null,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messageCount: isSelected ? selected.items.filter((item) => item.type === 'user').length : 0,
      linesAdded: isSelected ? selectedDiff.added : 0,
      linesRemoved: isSelected ? selectedDiff.removed : 0,
      running: chat.running,
      status,
      provider: isSelected ? selected.provider : chat.provider,
      chat,
      children: [],
      activity
    })
  }

  for (const chat of chats) {
    const row = byId.get(chat.paneId)!
    if (chat.pinnedAt == null && chat.parentPaneId && byId.get(chat.parentPaneId)?.cwd === row.cwd) byId.get(chat.parentPaneId)!.children.push(row)
    else rows.push(row)
  }

  return rows
}

/** The live thread name wins; otherwise the record's title, with a placeholder for a blank chat. */
function rowTitle(chat: ChatRowSummary, selectedThreadName: string | null): string {
  const live = sanitizeThreadTitle(selectedThreadName)
  if (live) return live
  if (!PLACEHOLDER_TITLES.has(chat.title) && !isInjectedContextTitle(chat.title)) return chat.title
  return chat.title || (chat.kind === 'subagent' ? 'Subagent task' : 'New chat')
}
