import { writeAtomic } from './atomic-write.js'
import { readStoreFile } from './store-recovery.js'
import { DEFAULT_SECURITY_SETTINGS, normalizeSecuritySettings, type SecuritySettings } from '../shared/security.js'

export type SecuritySettingsAccess = {
  get(): SecuritySettings
  set(patch: Partial<SecuritySettings>): Promise<SecuritySettings>
  onChange(listener: (settings: SecuritySettings) => void): () => void
}

/**
 * Settings → Security, one flat JSON object beside app-settings.json. A missing file means every
 * default (today's behavior); a file that cannot be read is quarantined, never overwritten, so a
 * user's explicit choices are not silently replaced by the permissive defaults.
 */
export class SecuritySettingsStore implements SecuritySettingsAccess {
  readonly #listeners = new Set<(settings: SecuritySettings) => void>()

  private constructor(
    private readonly filePath: string,
    private settings: SecuritySettings
  ) {}

  static async open(filePath: string): Promise<SecuritySettingsStore> {
    const settings = await readStoreFile(filePath, '[security-settings]', (text) => normalizeSecuritySettings(JSON.parse(text)))
    return new SecuritySettingsStore(filePath, settings ?? { ...DEFAULT_SECURITY_SETTINGS })
  }

  get(): SecuritySettings {
    return { ...this.settings }
  }

  async set(patch: Partial<SecuritySettings>): Promise<SecuritySettings> {
    this.settings = normalizeSecuritySettings({ ...this.settings, ...patch })
    await writeAtomic(this.filePath, `${JSON.stringify(this.settings, null, 2)}\n`)
    const snapshot = this.get()
    for (const listener of this.#listeners) listener(snapshot)
    return snapshot
  }

  onChange(listener: (settings: SecuritySettings) => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }
}
