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

export function createLocalUser(displayName: string, id: string, createdAt = Date.now()): LocalUser {
  const trimmed = displayName.trim()
  return {
    id,
    displayName: trimmed.length > 0 ? trimmed : 'User',
    avatarHue: avatarHueForUserId(id),
    createdAt
  }
}

function isChatProvider(value: unknown): value is ChatProvider {
  return typeof value === 'string' && (CHAT_PROVIDERS as readonly string[]).includes(value)
}

function normalizePhase(value: unknown): OnboardingPhase {
  return value === 'gate' || value === 'providers' || value === 'done' ? value : 'gate'
}

function normalizeUsers(value: unknown): LocalUser[] {
  if (!Array.isArray(value)) return []
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
    users.push({ id, displayName, avatarHue, createdAt })
  }
  return users
}

function normalizeConnectedProviders(value: unknown): ChatProvider[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(isChatProvider))]
}

export function normalizeOnboardingSettings(value: unknown): OnboardingSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_ONBOARDING_SETTINGS }
  const record = value as Record<string, unknown>
  const users = normalizeUsers(record.users)
  const activeUserId = typeof record.activeUserId === 'string' ? record.activeUserId : null
  const activeValid = activeUserId && users.some((user) => user.id === activeUserId) ? activeUserId : null
  return {
    phase: normalizePhase(record.phase),
    users,
    activeUserId: activeValid,
    keepSignedIn: record.keepSignedIn !== false,
    sessionUnlocked: record.sessionUnlocked === true,
    connectedProviders: normalizeConnectedProviders(record.connectedProviders),
    providerSetupComplete: record.providerSetupComplete === true
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

export function completedOnboardingSettings(): OnboardingSettings {
  return {
    ...DEFAULT_ONBOARDING_SETTINGS,
    phase: 'done',
    sessionUnlocked: true,
    providerSetupComplete: true
  }
}

/** End the local session and return to the sign-in gate; profiles and provider progress stay on disk. */
export function signOutSession(settings: OnboardingSettings): OnboardingSettings {
  return {
    ...settings,
    phase: 'gate',
    sessionUnlocked: false,
    activeUserId: null,
    keepSignedIn: false
  }
}
