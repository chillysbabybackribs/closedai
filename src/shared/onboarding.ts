import type { ChatProvider } from './chat.js'

/** A local workspace identity on this machine (not cloud auth). */
export type LocalUser = {
  id: string
  displayName: string
  /** 0–360 hue for the avatar ring; stable per id. */
  avatarHue: number
  createdAt: number
}

export type OnboardingPhase = 'gate' | 'providers' | 'done'

/** Renderer-persisted first-run and session gate state. */
export type OnboardingSettings = {
  phase: OnboardingPhase
  users: LocalUser[]
  activeUserId: string | null
  /** Skip the session gate on next launch when true and activeUserId is set. */
  keepSignedIn: boolean
  /** Whether the current launch passed the gate without re-prompting. */
  sessionUnlocked: boolean
  /** Providers the user marked connected during setup (CLI lanes) or that reached ready. */
  connectedProviders: ChatProvider[]
  providerSetupComplete: boolean
}

export const ONBOARDING_STORAGE_KEY = 'closedai.onboarding.v1'

export const DEFAULT_ONBOARDING_SETTINGS: OnboardingSettings = {
  phase: 'gate',
  users: [],
  activeUserId: null,
  keepSignedIn: true,
  sessionUnlocked: false,
  connectedProviders: [],
  providerSetupComplete: false
}
