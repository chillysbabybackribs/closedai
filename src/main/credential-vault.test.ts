import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { CredentialVault, KEYCHAIN_REQUIRED_MESSAGE, type VaultEncryption, type VaultPolicy } from './credential-vault.ts'

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
  run: (vault: CredentialVault, filePath: string) => Promise<void>,
  policy?: VaultPolicy
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-vault-'))
  const filePath = join(dir, 'credential-vault.json')
  try {
    await run(new CredentialVault(filePath, encryption, policy), filePath)
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

test('secretsRequireKeychain refuses a plain secret and still accepts a secret-free draft', async () => {
  const policy: VaultPolicy = { secretsRequireKeychain: () => true }
  await withVault(fakeEncryption(false), async (vault) => {
    await assert.rejects(
      vault.save({ serviceId: 'resend', label: '', values: { apiKey: 're_plain' } }),
      { message: KEYCHAIN_REQUIRED_MESSAGE }
    )
    assert.deepEqual(await vault.list(), [])
    const saved = await vault.save({ serviceId: 'custom', label: 'Host only', values: { url: 'https://x.example', secret: '' } })
      .catch((error: Error) => error)
    assert.ok(saved instanceof Error, 'custom requires its secret, so the catalog check still runs first')
  }, policy)
  await withVault(fakeEncryption(true), async (vault) => {
    const saved = await vault.save({ serviceId: 'resend', label: '', values: { apiKey: 're_enc' } })
    assert.equal(saved.encrypted, true)
  }, policy)
})

test('agent access defaults on, persists when switched off, and is read back for older records', async () => {
  await withVault(fakeEncryption(), async (vault, filePath) => {
    const saved = await vault.save({ serviceId: 'openai', label: 'Key', values: { apiKey: 'sk-1' } })
    assert.equal(saved.agentAccess, true)
    const off = await vault.setAgentAccess(saved.id, false)
    assert.equal(off.agentAccess, false)
    assert.equal(off.updatedAt, saved.updatedAt, 'the switch does not reorder the list')
    assert.equal((await new CredentialVault(filePath, fakeEncryption()).list())[0]?.agentAccess, false)
    await assert.rejects(vault.setAgentAccess('nope', true), /Credential not found/)

    // A record written before the field existed carries no key at all.
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as { credentials: Record<string, unknown>[] }
    delete raw.credentials[0]!.agentAccess
    await writeFile(filePath, JSON.stringify(raw))
    assert.equal((await new CredentialVault(filePath, fakeEncryption()).list())[0]?.agentAccess, true)
  })
})

test('an unreadable vault file is moved aside and never overwritten by the next save', async () => {
  await withVault(fakeEncryption(), async (vault, filePath) => {
    await writeFile(filePath, '{"version":1,"credentials":[{"id":"keep-me"')
    const original = console.warn
    console.warn = () => {}
    try {
      assert.deepEqual(await vault.list(), [])
      await vault.save({ serviceId: 'openai', label: '', values: { apiKey: 'sk-2' } })
    } finally {
      console.warn = original
    }
    const entries = (await readdir(join(filePath, '..'))).sort()
    assert.equal(entries[0], 'credential-vault.json')
    assert.match(entries[1]!, /^credential-vault\.json\.corrupt-/)
    assert.match(await readFile(join(filePath, '..', entries[1]!), 'utf8'), /keep-me/)
  })
})

test('failed vault mutations preserve committed data and do not poison later saves', async () => {
  await withVault(fakeEncryption(), async (vault, filePath) => {
    const saved = await vault.save({ serviceId: 'openai', label: 'Original', values: { apiKey: 'sk-original' } })
    await rename(filePath, `${filePath}.saved`)
    await mkdir(filePath)
    for (const change of [
      () => vault.setAgentAccess(saved.id, false),
      () => vault.rename(saved.id, 'Changed'),
      () => vault.remove(saved.id),
      () => vault.save({ serviceId: 'openai', label: 'Failed', values: { apiKey: 'sk-failed' } })
    ]) {
      await assert.rejects(change())
      assert.deepEqual(await vault.list(), [saved])
      assert.equal(await vault.reveal(saved.id, 'apiKey'), 'sk-original')
    }
    await rm(filePath, { recursive: true })
    await rename(`${filePath}.saved`, filePath)
    await vault.rename(saved.id, 'Recovered')
    assert.deepEqual(await new CredentialVault(filePath, fakeEncryption()).list(), await vault.list())
    assert.equal((await vault.list())[0].agentAccess, true)
  })
})

test('overlapping vault mutations retain every successful change in call order', async () => {
  await withVault(fakeEncryption(), async (vault, filePath) => {
    const saved = await vault.save({ serviceId: 'openai', label: 'Original', values: { apiKey: 'sk-1' } })
    const results = await Promise.all([
      vault.rename(saved.id, 'First'),
      vault.setAgentAccess(saved.id, false),
      vault.rename(saved.id, 'Last'),
      vault.save({ serviceId: 'openai', label: 'Second', values: { apiKey: 'sk-2' } }),
      vault.save({ serviceId: 'openai', label: 'Third', values: { apiKey: 'sk-3' } })
    ])
    assert.equal(results[1].label, 'First')
    assert.equal(results[2].agentAccess, false)
    assert.equal((await vault.list()).length, 3)
    assert.deepEqual(await new CredentialVault(filePath, fakeEncryption()).list(), await vault.list())
  })
})

test('structurally invalid JSON is preserved in full before a replacement vault is saved', async () => {
  const record = {
    id: 'keep-me', serviceId: 'openai', label: 'Saved', createdAt: 1, updatedAt: 1,
    fields: [{ id: 'apiKey', label: 'API key', kind: 'secret', value: 'recover-me', encrypted: false }]
  }
  for (const malformed of [
    null,
    { version: 1, credentials: {} },
    { version: 2, credentials: [record] },
    { version: 1, credentials: [record, null] },
    { version: 1, credentials: [{ ...record, fields: [{ ...record.fields[0], value: null }] }] }
  ]) {
    await withVault(fakeEncryption(), async (vault, filePath) => {
      const original = JSON.stringify(malformed)
      await writeFile(filePath, original)
      assert.deepEqual(await vault.list(), [])
      await vault.save({ serviceId: 'openai', label: 'New', values: { apiKey: 'sk-new' } })
      const backups = (await readdir(join(filePath, '..'))).filter((name) => name.includes('.corrupt-'))
      assert.equal(backups.length, 1)
      assert.equal(await readFile(join(filePath, '..', backups[0]), 'utf8'), original)
    })
  }
})
