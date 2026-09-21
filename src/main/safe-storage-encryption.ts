import type { SafeStorage } from 'electron'
import type { VaultEncryption } from './credential-vault.js'

type Storage = Pick<SafeStorage, 'isEncryptionAvailable' | 'encryptString' | 'decryptString' | 'getSelectedStorageBackend'>

/**
 * Electron's `safeStorage` as the vault sees it. On Linux `isEncryptionAvailable()` is true for
 * the `basic_text` backend too, which "encrypts" with a hardcoded key; that is reported as
 * unavailable so the Unencrypted badge and the `encrypted` flag say what is actually true.
 */
export function safeStorageEncryption(storage: Storage, platform: NodeJS.Platform): VaultEncryption {
  const backend = (): string => {
    if (!storage.isEncryptionAvailable()) return 'unavailable'
    if (platform === 'darwin') return 'keychain'
    if (platform === 'win32') return 'dpapi'
    return storage.getSelectedStorageBackend()
  }
  const usable = (): boolean => keychainUsable(backend())
  return {
    isAvailable: usable,
    encrypt: (plain) => storage.encryptString(plain).toString('base64'),
    decrypt: (payload) => storage.decryptString(Buffer.from(payload, 'base64')),
    backend: () => (usable() ? backend() : backend() === 'basic_text' ? 'unavailable (basic_text)' : 'unavailable')
  }
}

/** `basic_text` is Chromium's no-keyring fallback: readable by anyone with the file. */
export function keychainUsable(backend: string): boolean {
  return backend !== 'unavailable' && backend !== 'basic_text'
}
