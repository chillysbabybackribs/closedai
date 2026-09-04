import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { CredentialVault, type VaultEncryption } from './credential-vault.ts'

/** Stands in for safeStorage: reversible, and obviously not the stored plaintext. */
function fakeEncryption(available = true): VaultEncryption {
  return {
    isAvailable: () => available,
    encrypt: (plain) => Buffer.from(`enc:${plain}`, 'utf8').toString('base64'),
    decrypt: (payload) => {
      const decoded = Buffer.from(payload, 'base64').toString('utf8')
      if (!decoded.startsWith('enc:')) throw new Error('not ciphertext')
      return decoded.slice(4)
    },
    backend: () => (available ? 'fake-keyring' : 'unavailable')
  }
}

async function withVault(
  encryption: VaultEncryption,
  run: (vault: CredentialVault, filePath: string) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-vault-'))
  const filePath = join(dir, 'credential-vault.json')
  try {
    await run(new CredentialVault(filePath, encryption), filePath)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('a saved secret is encrypted on disk and revealed only on request', async () => {
  await withVault(fakeEncryption(), async (vault, filePath) => {
    const saved = await vault.save({
      serviceId: 'openai',
      label: 'Prod key',
      values: { apiKey: 'sk-secret-value', organizationId: 'org-42' }
    })

    const onDisk = await readFile(filePath, 'utf8')
    assert.ok(!onDisk.includes('sk-secret-value'), 'plaintext secret must not reach disk')
    assert.ok(onDisk.includes('org-42'), 'non-secret fields stay readable')

    const apiKey = saved.fields.find((field) => field.id === 'apiKey')
    assert.equal(apiKey?.preview.includes('sk-secret-value'), false)
    assert.equal(await vault.reveal(saved.id, 'apiKey'), 'sk-secret-value')
  })
})

test('missing required fields are rejected before anything is written', async () => {
  await withVault(fakeEncryption(), async (vault) => {
    await assert.rejects(
      vault.save({ serviceId: 'planetscale', label: '', values: { host: 'aws.connect.psdb.cloud' } }),
      /Missing required PlanetScale field\(s\): Username, Password/
    )
    assert.deepEqual(await vault.list(), [])
  })
})

test('generic API key and login entries retain the right field names', async () => {
  await withVault(fakeEncryption(), async (vault) => {
    const apiKey = await vault.save({
      serviceId: 'api-key',
      label: 'Build service',
      values: { url: 'https://api.example.com', apiKey: 'token-value' }
    })
    const login = await vault.save({
      serviceId: 'login',
      label: 'Admin account',
      values: { url: 'https://example.com', username: 'admin@example.com', password: 'password-value' }
    })

    assert.equal(apiKey.serviceName, 'API Key')
    assert.equal(apiKey.fields.find((field) => field.id === 'apiKey')?.label, 'API key')
    assert.equal(login.serviceName, 'Login')
    assert.equal(login.fields.find((field) => field.id === 'password')?.label, 'Password')
    assert.equal(await vault.reveal(login.id, 'password'), 'password-value')
  })
})

test('an unavailable keychain stores the secret unencrypted and reports it', async () => {
  await withVault(fakeEncryption(false), async (vault) => {
    const saved = await vault.save({ serviceId: 'resend', label: '', values: { apiKey: 're_plain' } })
    assert.equal(saved.encrypted, false)
    assert.equal(saved.label, 'Resend', 'a blank label falls back to the service name')
    assert.equal(await vault.reveal(saved.id, 'apiKey'), 're_plain')

    const status = await vault.status()
    assert.deepEqual(
      { available: status.encryptionAvailable, backend: status.backend, count: status.count },
      { available: false, backend: 'unavailable', count: 1 }
    )
  })
})

test('entries survive a reload and remove drops exactly one', async () => {
  await withVault(fakeEncryption(), async (vault, filePath) => {
    const first = await vault.save({ serviceId: 'stripe', label: 'Live', values: { secretKey: 'sk_live_1' } })
    await vault.save({ serviceId: 'redis', label: 'Cache', values: { connectionUrl: 'rediss://host' } })

    const reopened = new CredentialVault(filePath, fakeEncryption())
    assert.deepEqual(
      (await reopened.list()).map((entry) => entry.label).sort(),
      ['Cache', 'Live']
    )

    await reopened.remove(first.id)
    assert.deepEqual((await reopened.list()).map((entry) => entry.label), ['Cache'])
    assert.deepEqual((await new CredentialVault(filePath, fakeEncryption()).list()).map((e) => e.label), ['Cache'])
  })
})

test('reveal reports a decrypt failure instead of returning ciphertext', async () => {
  await withVault(fakeEncryption(), async (vault, filePath) => {
    const saved = await vault.save({ serviceId: 'openai', label: '', values: { apiKey: 'sk-x' } })
    const broken = new CredentialVault(filePath, {
      ...fakeEncryption(),
      decrypt: () => {
        throw new Error('keyring changed')
      }
    })
    await assert.rejects(broken.reveal(saved.id, 'apiKey'), /Unable to decrypt API key: keyring changed/)
  })
})
