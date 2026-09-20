import type { ChatSnapshot } from '../../shared/chat.js'
import type { ChatPeerSummary, PeerChatReadOptions, PeerChatReadResult } from '../../shared/chat-peers.js'
import type { ChatRecord } from '../../shared/chat-store.js'
import type { ChatTranscriptCache } from '../chat-store/chat-transcript-cache.js'
import { readableView } from './peer-events.js'
import { pageResult, subagentSummaries } from './peer-summary.js'

// What one chat may read of the others: every attached peer except itself, plus the subagent
// rows nested in those peers' transcripts. Reads page through the same view the renderer
// paints, so a parked pane's saved transcript is loaded before its live (empty) one is used.

export type ReadablePeerHost = {
  summaries(): ChatPeerSummary[]
  live(paneId: string): ChatSnapshot
  record(paneId: string): ChatRecord | undefined
  transcripts: Pick<ChatTranscriptCache, 'load' | 'peek'>
}

export function listReadablePeers(host: ReadablePeerHost, callerPaneId: string | null): ChatPeerSummary[] {
  return host.summaries().flatMap((peer) => [
    ...(peer.paneId === callerPaneId ? [] : [peer]),
    ...subagentSummaries(peer, host.live(peer.paneId))
  ])
}

export async function readReadablePeer(
  host: ReadablePeerHost,
  chatId: string,
  callerPaneId: string | null,
  options: PeerChatReadOptions
): Promise<PeerChatReadResult | null> {
  const direct = host.summaries().find((peer) => peer.paneId === chatId && peer.paneId !== callerPaneId)
  if (direct) {
    const { snapshot, source } = await peerView(host, chatId)
    return pageResult(direct, snapshot.items, options, source)
  }
  for (const peer of host.summaries()) {
    const { snapshot, source } = await peerView(host, peer.paneId)
    const subagent = subagentSummaries(peer, snapshot).find((entry) => entry.paneId === chatId)
    if (subagent) {
      const itemId = chatId.slice(peer.paneId.length + 1)
      return pageResult(subagent, snapshot.items.filter((item) => item.id === itemId), options, source)
    }
  }
  return null
}

/** The transcript a peer may read, loading the saved view a parked pane would need first. */
async function peerView(host: ReadablePeerHost, paneId: string): Promise<ReturnType<typeof readableView>> {
  const live = host.live(paneId)
  if (live.items.length === 0) await host.transcripts.load(paneId)
  return readableView(live, host.record(paneId), host.transcripts.peek(paneId))
}
