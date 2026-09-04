import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { writeAtomic } from './atomic-write.js'
import {
  credentialService,
  maskSecret,
  missingCredentialFields,
  type CredentialDraft,
  type CredentialFieldKind,
  type CredentialServiceId,
  type CredentialSummary,
  type CredentialVaultStatus
} from '../shared/credentials.js'

/**
 * The credential store. Secrets are encrypted by the OS keychain through Electron's
 * safeStorage before they touch disk; non-secret fields (hosts, usernames, URLs) stay
 * readable so the vault list renders without a decrypt round-trip. The renderer never
 * receives a plaintext secret until it asks for one field by id.
 *
 * Encryption is injected rather than imported so the store is testable outside Electron,
 * and so an unavailable keychain is a reported state instead of a crash.
 */

export type VaultEncryption = {
  isAvailable(): boolean
  /** Returns base64 ciphertext. */
  encrypt(plain: string): string
  decrypt(payload: string): string
  /** Reported to the user when encryption is unavailable. */
  backend(): string
}

type StoredField = {
  id: string
  label: string
  kind: CredentialFieldKind
  value: string
  encrypted: boolean
}

type StoredCredential = {
  id: string
  serviceId: CredentialServiceId
  label: string
  createdAt: number
  updatedAt: number
  fields: StoredField[]
}

type StoredVault = { version: 1; credentials: StoredCredential[] }

const EMPTY: StoredVault = { version: 1, credentials: [] }

export class CredentialVault {
  #filePath: string
  #encryption: VaultEncryption
  #loaded: Promise<StoredVault> | null = null

  constructor(filePath: string, encryption: VaultEncryption) {
    this.#filePath = filePath
    this.#encryption = encryption
  }

  async status(): Promise<CredentialVaultStatus> {
    const vault = await this.#load()
    return {
      encryptionAvailable: this.#encryption.isAvailable(),
      backend: this.#encryption.backend(),
      count: vault.credentials.length
    }
  }

  async list(): Promise<CredentialSummary[]> {
    const vault = await this.#load()
    return [...vault.credentials]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((record) => summarize(record))
  }

  async save(draft: CredentialDraft): Promise<CredentialSummary> {
    const service = credentialService(draft.serviceId)
    if (!service) throw new Error(`Unknown credential service: ${draft.serviceId}`)
    const missing = missingCredentialFields(draft)
    if (missing.length > 0) {
      throw new Error(`Missing required ${service.name} field(s): ${missing.map((field) => field.label).join(', ')}`)
    }

    const now = Date.now()
    const record: StoredCredential = {
      id: randomUUID(),
      serviceId: service.id,
      label: draft.label.trim() || service.name,
      createdAt: now,
      updatedAt: now,
      fields: service.fields.flatMap((spec) => {
        const value = draft.values[spec.id]?.trim() ?? ''
        if (!value) return []
        return [{ id: spec.id, label: spec.label, kind: spec.kind, ...this.#protect(spec.kind, value) }]
      })
    }

    const vault = await this.#load()
    vault.credentials.push(record)
    await this.#persist(vault)
    return summarize(record)
  }

  /** Decrypt one field on demand. The renderer asks per reveal or copy, never in bulk. */
  async reveal(credentialId: string, fieldId: string): Promise<string> {
    const vault = await this.#load()
    const record = vault.credentials.find((entry) => entry.id === credentialId)
    if (!record) throw new Error('Credential not found')
    const field = record.fields.find((entry) => entry.id === fieldId)
    if (!field) throw new Error('Credential field not found')
    if (!field.encrypted) return field.value
    try {
      return this.#encryption.decrypt(field.value)
    } catch (error) {
      // A keychain that changed under us (new OS user, reset keyring) cannot be
      // recovered from here; say so instead of returning ciphertext as a secret.
      throw new Error(`Unable to decrypt ${field.label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async remove(credentialId: string): Promise<void> {
    const vault = await this.#load()
    const next = vault.credentials.filter((entry) => entry.id !== credentialId)
    if (next.length === vault.credentials.length) return
    vault.credentials = next
    await this.#persist(vault)
  }

  async rename(credentialId: string, label: string): Promise<CredentialSummary> {
    const vault = await this.#load()
    const record = vault.credentials.find((entry) => entry.id === credentialId)
    if (!record) throw new Error('Credential not found')
    record.label = label.trim() || record.serviceId
    record.updatedAt = Date.now()
    await this.#persist(vault)
    return summarize(record)
  }

  #protect(kind: CredentialFieldKind, value: string): { value: string; encrypted: boolean } {
    if (kind !== 'secret' || !this.#encryption.isAvailable()) return { value, encrypted: false }
    return { value: this.#encryption.encrypt(value), encrypted: true }
  }

  #load(): Promise<StoredVault> {
    this.#loaded ??= readFile(this.#filePath, 'utf8')
      .then((raw) => normalize(JSON.parse(raw) as unknown))
      .catch(() => structuredClone(EMPTY))
    return this.#loaded
  }

  async #persist(vault: StoredVault): Promise<void> {
    this.#loaded = Promise.resolve(vault)
    await writeAtomic(this.#filePath, JSON.stringify(vault, null, 2))
  }
}

function normalize(parsed: unknown): StoredVault {
  if (!parsed || typeof parsed !== 'object') return structuredClone(EMPTY)
  const credentials = (parsed as StoredVault).credentials
  if (!Array.isArray(credentials)) return structuredClone(EMPTY)
  return {
    version: 1,
    credentials: credentials.filter(
      (record): record is StoredCredential =>
        Boolean(record) && typeof record.id === 'string' && Array.isArray(record.fields)
    )
  }
}

function summarize(record: StoredCredential): CredentialSummary {
  const service = credentialService(record.serviceId)
  return {
    id: record.id,
    serviceId: record.serviceId,
    serviceName: service?.name ?? record.serviceId,
    label: record.label,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    encrypted: record.fields.every((field) => field.kind !== 'secret' || field.encrypted),
    fields: record.fields.map((field) => ({
      id: field.id,
      label: field.label,
      kind: field.kind,
      // Ciphertext length says nothing useful, so an encrypted secret gets a fixed mask.
      preview: field.kind === 'secret' ? (field.encrypted ? maskSecret('••••••••••••') : maskSecret(field.value)) : field.value,
      hasValue: field.value.length > 0
    }))
  }
}
