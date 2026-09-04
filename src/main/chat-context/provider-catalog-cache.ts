import type { ChatModel, ChatProvider } from '../../shared/chat.js'

// Model catalogs belong to a CLI and an account, not to one chat pane. Reading one costs a
// process spawn — a second or more — and every new pane used to pay it for every provider before
// its picker could offer their models. One entry per workspace and provider, briefly cached,
// lets a pane list the other providers' models without starting them, and lets a provider that
// is starting skip the catalog read when the workspace has a fresh one.

/** Short enough that signing in or out of a CLI is picked up without restarting the app. */
export const PROVIDER_CATALOG_TTL_MS = 10 * 60 * 1000

export type ProviderCatalogEntry<Raw = unknown> = {
  at: number
  /** The catalog as the pane shows it. */
  models: ChatModel[]
  /** The provider-native listing it was built from, for providers that rebuild preferences from it. */
  raw: Raw | null
}

export class WorkspaceCatalogs {
  private readonly entries = new Map<ChatProvider, ProviderCatalogEntry>()

  constructor(private readonly now: () => number = Date.now) {}

  read<Raw = unknown>(provider: ChatProvider): ProviderCatalogEntry<Raw> | null {
    const entry = this.entries.get(provider)
    if (!entry) return null
    if (this.now() - entry.at > PROVIDER_CATALOG_TTL_MS) {
      this.entries.delete(provider)
      return null
    }
    return entry as ProviderCatalogEntry<Raw>
  }

  /**
   * An empty catalog is a failed read, not a fact worth sharing. A reading without the native
   * listing (the hub learns catalogs from connection events) keeps the listing already held.
   */
  remember<Raw = unknown>(provider: ChatProvider, models: ChatModel[], raw: Raw | null = null): void {
    if (models.length === 0) return
    this.entries.set(provider, { at: this.now(), models, raw: raw ?? this.entries.get(provider)?.raw ?? null })
  }

  forget(provider?: ChatProvider): void {
    if (provider === undefined) this.entries.clear()
    else this.entries.delete(provider)
  }
}

export class ProviderCatalogCache {
  private readonly workspaces = new Map<string, WorkspaceCatalogs>()

  constructor(private readonly now: () => number = Date.now) {}

  forWorkspace(cwd: string): WorkspaceCatalogs {
    let catalogs = this.workspaces.get(cwd)
    if (!catalogs) {
      catalogs = new WorkspaceCatalogs(this.now)
      this.workspaces.set(cwd, catalogs)
    }
    return catalogs
  }
}
