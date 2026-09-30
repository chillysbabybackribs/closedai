import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { isProfileId } from '../../shared/local-profiles.js'

// The account list is read before `ready`, when the data directory is chosen, so this module is
// synchronous and has no Electron dependency. The file is small and written only on sign-in,
// sign-out and account changes.

export const PROFILE_REGISTRY_FILE = 'profiles.json'
export const PROFILE_DIRECTORY = 'profiles'

export type ProfileRegistry = {
  version: 1
  /**
   * The account that owns the root data directory: the data that existed before profiles did.
   * Assigned once. It keeps naming a deleted home account, so the root is never handed to
   * another account, whose own data lives in its profile directory.
   */
  homeUserId: string | null
  /** The account to open when nobody is signed in, so the usual person signs in without a relaunch. */
  lastActiveUserId: string | null
  /** Set for one launch by a profile switch, so a session without "keep me signed in" survives it. */
  resumeUserId: string | null
  /** Deleted accounts whose data was open at the time; set aside by the next launch. */
  pendingRemovals: string[]
  /** The renderer-owned onboarding settings, stored as the JSON text it wrote. */
  onboarding: string | null
}

export type RegistryAccount = { id: string; createdAt: number }

export const EMPTY_PROFILE_REGISTRY: ProfileRegistry = {
  version: 1,
  homeUserId: null,
  lastActiveUserId: null,
  resumeUserId: null,
  pendingRemovals: [],
  onboarding: null
}

function parseOnboarding(onboarding: string | null): Record<string, unknown> | null {
  if (!onboarding) return null
  try {
    const value: unknown = JSON.parse(onboarding)
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

export function registryAccounts(registry: ProfileRegistry): RegistryAccount[] {
  const users = parseOnboarding(registry.onboarding)?.users
  if (!Array.isArray(users)) return []
  const accounts: RegistryAccount[] = []
  for (const entry of users) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (!isProfileId(record.id)) continue
    const createdAt = typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0
    accounts.push({ id: record.id, createdAt })
  }
  return accounts
}

/** The signed-in account, or null at the gate. */
export function registryActiveUserId(registry: ProfileRegistry): string | null {
  const settings = parseOnboarding(registry.onboarding)
  const active = settings?.activeUserId
  if (!isProfileId(active) || settings?.sessionUnlocked !== true) return null
  return registryAccounts(registry).some((account) => account.id === active) ? active : null
}

/**
 * Record what the renderer wrote. The oldest account owns the root directory: data that predates
 * profiles belongs to whoever was there first, and on a fresh install that is the first account.
 */
export function withOnboarding(registry: ProfileRegistry, onboarding: string): ProfileRegistry {
  const next: ProfileRegistry = { ...registry, onboarding }
  const accounts = registryAccounts(next)
  const known = (id: string | null): id is string => id !== null && accounts.some((account) => account.id === id)
  const oldest = accounts.reduce<RegistryAccount | null>(
    (first, account) => (first === null || account.createdAt < first.createdAt ? account : first),
    null
  )
  next.homeUserId = registry.homeUserId ?? oldest?.id ?? null
  next.lastActiveUserId = registryActiveUserId(next) ?? (known(registry.lastActiveUserId) ? registry.lastActiveUserId : null)
  next.resumeUserId = known(registry.resumeUserId) ? registry.resumeUserId : null
  return next
}

/**
 * Take an account out of the list. A deleted account that was signed in leaves the session at
 * the gate. Null when the list has no such account.
 */
export function withoutAccount(registry: ProfileRegistry, userId: string): ProfileRegistry | null {
  const settings = parseOnboarding(registry.onboarding)
  if (!settings || !Array.isArray(settings.users)) return null
  if (!registryAccounts(registry).some((account) => account.id === userId)) return null
  const users = settings.users.filter((entry) => (entry as { id?: unknown } | null)?.id !== userId)
  const signedOut = settings.activeUserId === userId
    ? { phase: 'gate', activeUserId: null, sessionUnlocked: false }
    : {}
  const forget = (id: string | null): string | null => (id === userId ? null : id)
  return {
    ...registry,
    lastActiveUserId: forget(registry.lastActiveUserId),
    resumeUserId: forget(registry.resumeUserId),
    onboarding: JSON.stringify({ ...settings, ...signedOut, users })
  }
}

/** The account a launch opens: whoever is signed in, else whoever was last, else the home account. */
export function launchUserId(registry: ProfileRegistry): string | null {
  const accounts = registryAccounts(registry)
  const known = (id: string | null): id is string => id !== null && accounts.some((account) => account.id === id)
  const active = registryActiveUserId(registry)
  if (active) return active
  if (known(registry.resumeUserId)) return registry.resumeUserId
  if (known(registry.lastActiveUserId)) return registry.lastActiveUserId
  return known(registry.homeUserId) ? registry.homeUserId : null
}

/** Where an account's data lives. The home account, and a launch with no accounts, use the root. */
export function profileDataDir(root: string, registry: ProfileRegistry, userId: string | null): string {
  if (userId === null || userId === registry.homeUserId || !isProfileId(userId)) return root
  return join(root, PROFILE_DIRECTORY, userId)
}

function normalizeRegistry(value: unknown): ProfileRegistry {
  if (!value || typeof value !== 'object') return { ...EMPTY_PROFILE_REGISTRY }
  const record = value as Record<string, unknown>
  const id = (entry: unknown): string | null => (isProfileId(entry) ? entry : null)
  return {
    version: 1,
    homeUserId: id(record.homeUserId),
    lastActiveUserId: id(record.lastActiveUserId),
    resumeUserId: id(record.resumeUserId),
    pendingRemovals: Array.isArray(record.pendingRemovals) ? record.pendingRemovals.filter(isProfileId) : [],
    onboarding: typeof record.onboarding === 'string' ? record.onboarding : null
  }
}

/** Only a missing file is an empty registry; an unreadable one is set aside, never overwritten. */
export function readProfileRegistry(root: string): ProfileRegistry {
  const path = join(root, PROFILE_REGISTRY_FILE)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return { ...EMPTY_PROFILE_REGISTRY }
  }
  try {
    return normalizeRegistry(JSON.parse(raw))
  } catch {
    const aside = `${path}.corrupt-${Date.now()}`
    try {
      renameSync(path, aside)
      console.warn(`[profiles] ${PROFILE_REGISTRY_FILE} could not be read; kept as ${aside}`)
    } catch { /* The next write replaces it; there is nothing else to keep it with. */ }
    return { ...EMPTY_PROFILE_REGISTRY }
  }
}

export function writeProfileRegistry(root: string, registry: ProfileRegistry): void {
  mkdirSync(root, { recursive: true })
  const path = join(root, PROFILE_REGISTRY_FILE)
  const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
  // Password hashes live here, so the file is private to the OS user.
  writeFileSync(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporaryPath, path)
}
