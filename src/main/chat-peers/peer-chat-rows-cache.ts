import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { chatRecordIsBlank } from '../../shared/chat-store.js'
import { rowSummary } from './peer-events.js'
import type { PeerManagerSupportHost } from './peer-manager-support.js'

/** Drawer rows: attached panes refresh every emit; detached history rebuilds only when it may have changed. */
export class PeerChatRowsCache {
  private detached: ChatRowSummary[] | null = null

  /** Store or lifecycle membership changed for chats that appear in the detached list. */
  invalidateDetached(): void {
    this.detached = null
  }

  rows(host: PeerManagerSupportHost): ChatRowSummary[] {
    const attachedIds = new Set(host.lifecycle.ids())
    if (!this.detached) this.detached = buildDetachedRows(host, attachedIds)
    const attached = buildAttachedRows(host, attachedIds)
    return mergeSortedByUpdatedAt(attached, this.detached)
  }
}

function buildAttachedRows(host: PeerManagerSupportHost, attachedIds: Set<string>): ChatRowSummary[] {
  const rows: ChatRowSummary[] = []
  for (const id of attachedIds) {
    const record = host.store.get(id)
    if (!record || record.archived) continue
    const live = host.lifecycle.get(id)?.display.current ?? null
    rows.push({
      ...rowSummary(record, live),
      pendingProject: host.projectChanges.selection(id)
    })
  }
  return rows
}

function buildDetachedRows(host: PeerManagerSupportHost, attachedIds: Set<string>): ChatRowSummary[] {
  return host.store.ids()
    .map((id) => host.store.require(id))
    .filter((record) => !attachedIds.has(record.id)
      && (record.pinnedAt !== null || !chatRecordIsBlank(record)))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    .map((record) => ({
      ...rowSummary(record, null),
      pendingProject: host.projectChanges.selection(record.id)
    }))
}

function mergeSortedByUpdatedAt(first: ChatRowSummary[], second: ChatRowSummary[]): ChatRowSummary[] {
  const merged: ChatRowSummary[] = []
  let left = 0
  let right = 0
  while (left < first.length && right < second.length) {
    const pickLeft = first[left]!.updatedAt > second[right]!.updatedAt
      || (first[left]!.updatedAt === second[right]!.updatedAt && first[left]!.paneId.localeCompare(second[right]!.paneId) < 0)
    if (pickLeft) merged.push(first[left++]!)
    else merged.push(second[right++]!)
  }
  while (left < first.length) merged.push(first[left++]!)
  while (right < second.length) merged.push(second[right++]!)
  return merged
}
