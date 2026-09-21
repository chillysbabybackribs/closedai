import assert from 'node:assert/strict'
import test from 'node:test'

import { keychainUsable, safeStorageEncryption } from './safe-storage-encryption.ts'

function storage(available: boolean, backend: string) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain: string) => Buffer.from(`enc:${plain}`),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').slice(4),
    getSelectedStorageBackend: () => backend as ReturnType<Electron.SafeStorage['getSelectedStorageBackend']>
  }
}

test('a real Linux keyring is available and named', () => {
  const encryption = safeStorageEncryption(storage(true, 'gnome_libsecret'), 'linux')
  assert.equal(encryption.isAvailable(), true)
  assert.equal(encryption.backend(), 'gnome_libsecret')
  assert.equal(encryption.decrypt(encryption.encrypt('s3cret')), 's3cret')
})

test('basic_text on Linux is reported as unavailable even though Electron says encryption works', () => {
  const encryption = safeStorageEncryption(storage(true, 'basic_text'), 'linux')
  assert.equal(encryption.isAvailable(), false)
  assert.equal(encryption.backend(), 'unavailable (basic_text)')
})

test('no encryption at all is unavailable; macOS and Windows report their OS store', () => {
  assert.equal(safeStorageEncryption(storage(false, 'unknown'), 'linux').backend(), 'unavailable')
  assert.equal(safeStorageEncryption(storage(true, 'unknown'), 'darwin').backend(), 'keychain')
  assert.equal(safeStorageEncryption(storage(true, 'unknown'), 'win32').backend(), 'dpapi')
  assert.deepEqual([keychainUsable('basic_text'), keychainUsable('unavailable'), keychainUsable('kwallet6')], [false, false, true])
})
