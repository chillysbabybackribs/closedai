import { readFile } from 'node:fs/promises'
import type { ChatModel, ChatProvider } from '../../shared/chat.js'
import { CHAT_PROVIDERS } from '../../shared/chat-providers.js'
import { writeAtomic } from '../atomic-write.js'

// Model catalogs belong to a CLI and an account, not to one chat pane. Reading one costs a
// process spawn — a second or more — and every new pane used to pay it for every provider before
// its picker could offer their models. One entry per workspace and provider lets a pane list the
// other providers' models without starting them, and lets a provider that is starting skip the
// catalog read when the workspace has a fresh one. The cache is written to disk, so a relaunch
// starts one provider rather than four: a catalog is never wrong enough to be worth a spawn to
// check, and the provider refreshes it the first time this pane actually selects it.

/**
 * How long a catalog counts as fresh enough to stand in for the provider's own start-up read —
 * short enough that signing in or out of a CLI is picked up without restarting the app. Older
 * entries still fill the picker; they just no longer excuse a provider from proving sign-in.
 */
export const PROVIDER_CATALOG_TTL_MS = 10 * 60 * 1000

const WRITE_DELAY_MS = 500

export type ProviderCatalogEntry<Raw = unknown> = {
  at: number
  /** The catalog as the pane shows it. */
  models: ChatModel[]
  /** The provider-native listing it was built from, for providers that rebuild preferences from it. */
  raw: Raw | null
}

type CatalogFile = { version: 1; workspaces: Record<string, Partial<Record<ChatProvider, ProviderCatalogEntry>>> }

export class WorkspaceCatalogs {
  private readonly entries = new Map<ChatProvider, ProviderCatalogEntry>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly onChange: () => void = () => {}
  ) {}

  /**
   * The last catalog read for the provider, whatever its age; `maxAgeMs` asks for one no older
   * than that and reads as missing otherwise.
   */
  read<Raw = unknown>(provider: ChatProvider, maxAgeMs = Number.POSITIVE_INFINITY): ProviderCatalogEntry<Raw> | null {
    const entry = this.entries.get(provider)
    if (!entry) return null
    if (this.now() - entry.at > maxAgeMs) return null
    return entry as ProviderCatalogEntry<Raw>
  }

  /**
   * An empty catalog is a failed read, not a fact worth sharing. A reading without the native
   * listing (the hub learns catalogs from connection events) keeps the listing already held.
   */
  remember<Raw = unknown>(provider: ChatProvider, models: ChatModel[], raw: Raw | null = null): void {
    if (models.length === 0) return
    this.entries.set(provider, { at: this.now(), models, raw: raw ?? this.entries.get(provider)?.raw ?? null })
    this.onChange()
  }

  forget(provider?: ChatProvider): void {
    if (provider === undefined) this.entries.clear()
    else this.entries.delete(provider)
    this.onChange()
  }

  /** @internal Serialized form for the cache file. */
  toJSON(): Partial<Record<ChatProvider, ProviderCatalogEntry>> {
    return Object.fromEntries(this.entries)
  }

  /** @internal Load entries read from the cache file, skipping anything malformed. */
  load(entries: Partial<Record<ChatProvider, ProviderCatalogEntry>>): void {
    for (const provider of CHAT_PROVIDERS) {
      const entry = entries[provider]
      if (!entry || typeof entry.at !== 'number' || !Array.isArray(entry.models) || entry.models.length === 0) continue
      this.entries.set(provider, { at: entry.at, models: entry.models, raw: entry.raw ?? null })
    }
  }
}

export class ProviderCatalogCache {
  private readonly workspaces = new Map<string, WorkspaceCatalogs>()
  private writeTimer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly now: () => number = Date.now, private readonly filePath: string | null = null) {}

  /** The cache backed by `filePath`, seeded from what an earlier run left there. */
  static async open(filePath: string, now: () => number = Date.now): Promise<ProviderCatalogCache> {
    const cache = new ProviderCatalogCache(now, filePath)
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Partial<CatalogFile>
      if (parsed.version === 1 && parsed.workspaces && typeof parsed.workspaces === 'object') {
        for (const [cwd, entries] of Object.entries(parsed.workspaces)) {
          if (entries && typeof entries === 'object') cache.forWorkspace(cwd).load(entries)
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[chat] could not read the provider catalog cache:', error instanceof Error ? error.message : String(error))
      }
    }
    return cache
  }

  forWorkspace(cwd: string): WorkspaceCatalogs {
    let catalogs = this.workspaces.get(cwd)
    if (!catalogs) {
      catalogs = new WorkspaceCatalogs(this.now, () => this.changed())
      this.workspaces.set(cwd, catalogs)
    }
    return catalogs
  }

  /** Wait for every scheduled write to land; called before quit. */
  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
      this.persist()
    }
    await this.writing
  }

  private changed(): void {
    if (!this.filePath || this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.persist()
    }, WRITE_DELAY_MS)
    this.writeTimer.unref?.()
  }

  private persist(): void {
    const path = this.filePath
    if (!path) return
    const file: CatalogFile = {
      version: 1,
      workspaces: Object.fromEntries([...this.workspaces].map(([cwd, catalogs]) => [cwd, catalogs.toJSON()]))
    }
    const contents = `${JSON.stringify(file)}\n`
    this.writing = this.writing
      .then(() => writeAtomic(path, contents))
      .catch((error: unknown) => {
        console.warn('[chat] could not persist the provider catalog cache:', error instanceof Error ? error.message : String(error))
      })
  }
}
