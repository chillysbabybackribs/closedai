import type { ChatPaneId } from '../../shared/chat-peers.js'
import type { ChatSurface } from '../chat-hub.js'

export type ParkablePeer = {
  surface: ChatSurface
  idleTimer: NodeJS.Timeout | null
  parked: boolean
}

const DEFAULT_IDLE_PARK_MS = 5 * 60 * 1000

/** Retire unfocused provider runtimes without interrupting background turns. */
export class PeerIdleParking {
  constructor(
    private readonly peer: (paneId: ChatPaneId) => ParkablePeer | undefined,
    private readonly selectedPaneId: () => ChatPaneId,
    private readonly idleMs = DEFAULT_IDLE_PARK_MS
  ) {}

  async wake(paneId: ChatPaneId): Promise<ParkablePeer> {
    const entry = this.peer(paneId)
    if (!entry) throw new Error(`Unknown chat pane: ${paneId}`)
    this.cancel(entry)
    if (!entry.parked) return entry
    entry.parked = false
    try {
      await entry.surface.start()
      this.cancel(entry)
    } catch (error) {
      entry.parked = true
      throw error
    }
    return entry
  }

  schedule(paneId: ChatPaneId): void {
    if (paneId === this.selectedPaneId()) return
    const entry = this.peer(paneId)
    if (!entry || entry.parked || entry.idleTimer || entry.surface.snapshot({ limit: 0 }).activeTurnId) return
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null
      if (paneId === this.selectedPaneId() || entry.surface.snapshot({ limit: 0 }).activeTurnId) return
      entry.parked = true
      entry.surface.stop()
    }, this.idleMs)
    entry.idleTimer.unref?.()
  }

  cancel(entry: ParkablePeer): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    entry.idleTimer = null
  }

  stop(entry: ParkablePeer): void {
    this.cancel(entry)
    entry.parked = true
    entry.surface.stop()
  }
}
