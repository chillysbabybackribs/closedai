import { readFile } from 'node:fs/promises'
import { writeAtomic } from './atomic-write.js'
import type { AppSettings } from '../shared/types.ts'

// App-scoped preferences that must live in the main process because they shape how
// the Codex app-server is driven (see codex-client thread/start + thread/resume).
// Kept deliberately tiny: one flat JSON object, no debouncing or retention — settings
// change rarely and each write is a single small object, so a plain atomic write per
// change is simpler than the machinery ChatHistoryStore needs for a hot append path.

export const DEFAULT_APP_SETTINGS: AppSettings = {
  // Cookies from the user's real browser have not been imported yet; the first
  // successful import flips this so it happens exactly once.
  browserCookiesImported: false,
  chatThreadId: null,
  chatModelId: null,
  disabledTools: []
}

function normalize(parsed: unknown): AppSettings {
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_APP_SETTINGS }
  const record = parsed as Record<string, unknown>
  return {
    browserCookiesImported:
      typeof record.browserCookiesImported === 'boolean'
        ? record.browserCookiesImported
        : DEFAULT_APP_SETTINGS.browserCookiesImported,
    chatThreadId: typeof record.chatThreadId === 'string' && record.chatThreadId.length > 0
      ? record.chatThreadId
      : null,
    chatModelId: typeof record.chatModelId === 'string' && record.chatModelId.length > 0
      ? record.chatModelId
      : null,
    disabledTools: Array.isArray(record.disabledTools)
      ? [...new Set(record.disabledTools.filter((id): id is string => typeof id === 'string' && id.length > 0))]
      : []
  }
}

export class AppSettingsStore {
  private constructor(
    private readonly filePath: string,
    private settings: AppSettings
  ) {}

  static async open(filePath: string): Promise<AppSettingsStore> {
    let settings: AppSettings = { ...DEFAULT_APP_SETTINGS }
    try {
      settings = normalize(JSON.parse(await readFile(filePath, 'utf8')))
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      // A missing file is the first-run case; a malformed file falls back to defaults
      // rather than crashing startup. Either way the next write lays down clean JSON.
      if (code !== 'ENOENT') console.warn('app settings unreadable, using defaults:', messageOf(error))
    }
    return new AppSettingsStore(filePath, settings)
  }

  get(): AppSettings {
    return { ...this.settings }
  }

  // Merge a partial patch, persist, and return the full resolved settings. Returns the
  // new state so the caller can react (e.g. re-resume threads) without a second read.
  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = normalize({ ...this.settings, ...patch })
    await writeAtomic(this.filePath, `${JSON.stringify(this.settings, null, 2)}\n`)
    return this.get()
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
