import type { ChatPaneId } from '../../shared/chat-peers.js'
import type { ChatSurface } from '../chat-hub.js'

export type ParkablePeer = {
  surface: ChatSurface
  idleTimer: NodeJS.Timeout | null
  parked: boolean
}

const DEFAULT_IDLE_PARK_MS = 5 * 60 * 1000
/**
 * The selected chat parks too, just later: a chat left open on screen with nothing happening
 * should not hold a provider process all afternoon. Its transcript stays in memory, so the pane
 * looks the same; the next message wakes the runtime first.
 */
export const SELECTED_IDLE_PARK_MULTIPLIER = 4

/** Retire idle provider runtimes without interrupting background turns. */
export class PeerIdleParking {
  constructor(
    private readonly peer: (paneId: ChatPaneId) => ParkablePeer | undefined,
    private readonly selectedPaneId: () => ChatPaneId,
    private readonly idleMs = DEFAULT_IDLE_PARK_MS,
    private readonly selectedIdleMs = idleMs * SELECTED_IDLE_PARK_MULTIPLIER
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

  /** Start the idle clock: the grace period for an unselected chat, the longer one for the selected. */
  schedule(paneId: ChatPaneId): void {
    const entry = this.peer(paneId)
    if (!entry || entry.parked || entry.idleTimer || entry.surface.snapshot({ limit: 0 }).activeTurnId) return
    const selected = paneId === this.selectedPaneId()
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null
      if (entry.surface.snapshot({ limit: 0 }).activeTurnId) return
      // Selected since the clock started: it earns the longer window rather than parking now.
      if (!selected && paneId === this.selectedPaneId()) {
        this.schedule(paneId)
        return
      }
      entry.parked = true
      entry.surface.stop()
    }, selected ? this.selectedIdleMs : this.idleMs)
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
