import type { ChatProvider } from '../../shared/chat.js'
import { CHAT_PROVIDERS } from '../../shared/chat-providers.js'
import {
  DEFAULT_ONBOARDING_SETTINGS,
  ONBOARDING_STORAGE_KEY,
  type LocalUser,
  type OnboardingPhase,
  type OnboardingSettings
} from '../../shared/onboarding.js'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function avatarHueForUserId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 360
  return hash
}

export function createLocalUser(
  displayName: string,
  id: string,
  passwordHash: string,
  createdAt = Date.now()
): LocalUser {
  const trimmed = displayName.trim()
  return {
    id,
    displayName: trimmed.length > 0 ? trimmed : 'User',
    avatarHue: avatarHueForUserId(id),
    createdAt,
    passwordHash,
    // Staying signed in is something a person chooses, never the default.
    keepSignedIn: false,
    connectedProviders: [],
    providerSetupComplete: false
  }
}

function isChatProvider(value: unknown): value is ChatProvider {
  return typeof value === 'string' && (CHAT_PROVIDERS as readonly string[]).includes(value)
}

function normalizePhase(value: unknown): OnboardingPhase {
  return value === 'gate' || value === 'providers' || value === 'done' ? value : 'gate'
}

function normalizeConnectedProviders(value: unknown): ChatProvider[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(isChatProvider))]
}

function normalizeUsers(value: unknown, legacy: Record<string, unknown>): LocalUser[] {
  if (!Array.isArray(value)) return []
  const legacyConnected = normalizeConnectedProviders(legacy.connectedProviders)
  const legacyComplete = legacy.providerSetupComplete === true
  const legacyKeep = legacy.keepSignedIn !== false
  const users: LocalUser[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : ''
    const displayName = typeof record.displayName === 'string' ? record.displayName.trim() : ''
    if (!id || !displayName) continue
    const createdAt = typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
      ? record.createdAt
      : Date.now()
    const avatarHue = typeof record.avatarHue === 'number' && Number.isFinite(record.avatarHue)
      ? record.avatarHue
      : avatarHueForUserId(id)
    const rawHash = typeof record.passwordHash === 'string' ? record.passwordHash.trim() : ''
    const passwordHash = rawHash.length > 0 ? rawHash : undefined
    const hasOwnProviders = record.connectedProviders !== undefined
    const hasOwnComplete = record.providerSetupComplete !== undefined
    const hasOwnKeep = record.keepSignedIn !== undefined
    users.push({
      id,
      displayName,
      avatarHue,
      createdAt,
      passwordHash,
      keepSignedIn: hasOwnKeep ? record.keepSignedIn !== false : legacyKeep,
      connectedProviders: hasOwnProviders
        ? normalizeConnectedProviders(record.connectedProviders)
        : [...legacyConnected],
      providerSetupComplete: hasOwnComplete ? record.providerSetupComplete === true : legacyComplete
    })
  }
  return users
}

export function normalizeOnboardingSettings(value: unknown): OnboardingSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_ONBOARDING_SETTINGS }
  const record = value as Record<string, unknown>
  const users = normalizeUsers(record.users, record)
  const activeUserId = typeof record.activeUserId === 'string' ? record.activeUserId : null
  const activeValid = activeUserId && users.some((user) => user.id === activeUserId) ? activeUserId : null
  return {
    phase: normalizePhase(record.phase),
    users,
    activeUserId: activeValid,
    sessionUnlocked: record.sessionUnlocked === true
  }
}

/** Absent storage means a fresh install; callers run legacy bypass before showing the gate. */
export function readOnboardingSettings(storage: StorageLike): OnboardingSettings | null {
  const raw = storage.getItem(ONBOARDING_STORAGE_KEY)
  if (!raw) return null
  try {
    return normalizeOnboardingSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_ONBOARDING_SETTINGS }
  }
}

export function writeOnboardingSettings(storage: StorageLike, settings: OnboardingSettings): void {
  storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(settings))
}

export function findLocalUser(settings: OnboardingSettings, userId: string | null): LocalUser | null {
  if (!userId) return null
  return settings.users.find((user) => user.id === userId) ?? null
}

export function patchLocalUser(
  settings: OnboardingSettings,
  userId: string,
  patch: Partial<LocalUser>
): OnboardingSettings {
  return {
    ...settings,
    users: settings.users.map((user) => (user.id === userId ? { ...user, ...patch } : user))
  }
}

export function phaseForUser(user: LocalUser | null, sessionUnlocked: boolean): OnboardingPhase {
  if (!sessionUnlocked || !user) return 'gate'
  return user.providerSetupComplete ? 'done' : 'providers'
}

/** Stable id for chat-history bypass installs that skip the session gate without creating a named account. */
export const LEGACY_BYPASS_PROFILE_ID = 'closedai-legacy-bypass-profile'

export function legacyBypassProfileUser(): LocalUser {
  return {
    ...createLocalUser('Local profile', LEGACY_BYPASS_PROFILE_ID, '', 0),
    // An install from before the gate existed keeps opening straight into its workspace.
    keepSignedIn: true,
    providerSetupComplete: true
  }
}

/** Unlocked sessions must expose a local profile for the title-bar account menu and sign-out. */
export function ensureActiveSessionProfile(settings: OnboardingSettings): OnboardingSettings {
  if (!settings.sessionUnlocked) return settings
  const activeId = settings.activeUserId
  if (activeId && settings.users.some((user) => user.id === activeId)) return settings
  const existingLegacy = settings.users.find((user) => user.id === LEGACY_BYPASS_PROFILE_ID)
  if (existingLegacy) {
    return { ...settings, activeUserId: existingLegacy.id }
  }
  const legacy = legacyBypassProfileUser()
  return {
    ...settings,
    users: [...settings.users, legacy],
    activeUserId: legacy.id
  }
}

export function completedOnboardingSettings(): OnboardingSettings {
  const legacy = legacyBypassProfileUser()
  return {
    ...DEFAULT_ONBOARDING_SETTINGS,
    phase: 'done',
    sessionUnlocked: true,
    users: [legacy],
    activeUserId: legacy.id
  }
}

/** End the local session and return to the sign-in gate; profiles and per-user provider progress stay on disk. */
export function signOutSession(settings: OnboardingSettings): OnboardingSettings {
  return {
    ...settings,
    phase: 'gate',
    sessionUnlocked: false,
    activeUserId: null
  }
}
