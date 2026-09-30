import type { ChatTranscriptItem } from '../../shared/chat.js'
import type { ChatRecord } from '../../shared/chat-store.js'

export type PaneTranscriptRead = (threadId: string, cwd?: string) => Promise<{ items: ChatTranscriptItem[] }>

/** Same merge rules as peer_chats recall scope chat / rotated scope current. */
export async function mergedPaneTranscriptItems(
  pane: ChatRecord,
  snapshotItems: readonly ChatTranscriptItem[],
  readThread: PaneTranscriptRead,
  scope: 'current' | 'chat'
): Promise<{ items: ChatTranscriptItem[]; partial: boolean }> {
  const rotations = pane.sessionRotations ?? []
  if (scope === 'current' && rotations.length === 0) {
    return { items: [...snapshotItems], partial: false }
  }
  const boundary = rotations.at(-1)?.sourceThroughItemId
  if (boundary && snapshotItems.some((item) => item.id === boundary)) {
    return { items: [...snapshotItems], partial: false }
  }
  const cont = pane.continuation
  if (cont?.sourcePaneId !== pane.id || !cont.sourceThreadId) {
    return { items: [...snapshotItems], partial: rotations.length > 0 }
  }
  try {
    const retired = await readThread(cont.sourceThreadId, cont.sourceCwd)
    const seen = new Set(retired.items.map((item) => item.id))
    return {
      items: [...retired.items, ...snapshotItems.filter((item) => !seen.has(item.id))],
      partial: false
    }
  } catch {
    return { items: [...snapshotItems], partial: true }
  }
}
