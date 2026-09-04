import type { ChatSurface } from '../chat-hub.js'
import type { ChatStore } from '../chat-store/chat-store.js'
import type { ChatWorkspaceSelection } from './peer-manager.js'

// Keeps the store in step with what the providers have on disk. The store answers the drawer at
// once; this scan runs behind it, adopting threads the providers know and the store does not
// (chats from before the store existed, or made by another client) and refreshing the titles of
// the ones it has. The scan reads every session each provider stored — seconds of main-process
// work on a busy workspace — so callers within the window share one answer, a request in flight
// is joined rather than started twice, and a result that lands after a project switch is dropped.

/** How long a completed scan is reused before the providers are read again. */
export const CHAT_CATALOG_CACHE_MS = 5_000

export class PeerChatCatalog {
  private scanned: { at: number; cwd: string } | null = null
  private inFlight: Promise<void> | null = null

  constructor(
    private readonly store: ChatStore,
    private readonly workspace: () => ChatWorkspaceSelection,
    private readonly withSelected: <T>(action: (surface: ChatSurface) => Promise<T>) => Promise<T>
  ) {}

  /** Forget the last scan: a turn ended, a chat was archived or opened, or the project changed. */
  invalidate(): void {
    this.scanned = null
  }

  reconcile(): Promise<void> {
    const { cwd, projectPath } = this.workspace()
    if (this.scanned && this.scanned.cwd === cwd && Date.now() - this.scanned.at < CHAT_CATALOG_CACHE_MS) return Promise.resolve()
    this.inFlight ??= this.withSelected((surface) => surface.listThreads())
      .then((threads) => {
        if (this.workspace().cwd !== cwd) return
        for (const thread of threads) this.store.adopt(cwd, projectPath, thread, null)
        this.scanned = { at: Date.now(), cwd }
      })
      .finally(() => { this.inFlight = null })
    return this.inFlight
  }
}
