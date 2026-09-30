import type { ChatProvider } from './chat.js'

/** A local workspace identity on this machine (not cloud auth). */
export type LocalUser = {
  id: string
  displayName: string
  /** 0–360 hue for the avatar ring; stable per id. */
  avatarHue: number
  createdAt: number
  /** PBKDF2 hash from `hashLocalProfilePassword`; absent on profiles created before passwords. */
  passwordHash?: string
  /** Skip the session gate on next launch for this profile when true. */
  keepSignedIn: boolean
  /** Providers this profile marked connected during setup or that reached ready while signed in. */
  connectedProviders: ChatProvider[]
  /** When true, the provider setup modal does not block this profile after sign-in. */
  providerSetupComplete: boolean
}

export type OnboardingPhase = 'gate' | 'providers' | 'done'

/** Renderer-persisted first-run and session gate state. */
export type OnboardingSettings = {
  phase: OnboardingPhase
  users: LocalUser[]
  activeUserId: string | null
  /** Whether the current launch passed the gate without re-prompting. */
  sessionUnlocked: boolean
}

export const ONBOARDING_STORAGE_KEY = 'closedai.onboarding.v1'

export const DEFAULT_ONBOARDING_SETTINGS: OnboardingSettings = {
  phase: 'gate',
  users: [],
  activeUserId: null,
  sessionUnlocked: false
}
