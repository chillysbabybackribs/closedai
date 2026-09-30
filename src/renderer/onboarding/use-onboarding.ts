import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ChatProvider } from '../../shared/chat.js'
import type { ChatSnapshot } from '../../shared/chat.js'
import { hashLocalProfilePassword, verifyLocalProfilePassword } from '../../shared/local-profile-password.js'
import type { LocalUser, OnboardingSettings } from '../../shared/onboarding.js'
import {
  completedOnboardingSettings,
  createLocalUser,
  ensureActiveSessionProfile,
  findLocalUser,
  patchLocalUser,
  phaseForUser,
  readOnboardingSettings,
  signOutSession,
  writeOnboardingSettings
} from './onboarding-settings.js'

export type SessionGateSignInResult =
  | { ok: true }
  | { ok: false; reason: 'unknown-user' | 'wrong-password' | 'password-required' }

export type SessionGateCreateResult =
  | { ok: true }
  | { ok: false; reason: 'name-required' | 'password-required' | 'password-too-short' }

export type OnboardingController = {
  settings: OnboardingSettings
  activeUser: LocalUser | null
  connectedProviders: readonly ChatProvider[]
  keepSignedIn: boolean
  showSessionGate: boolean
  showProviderSetup: boolean
  signIn: (userId: string, password: string) => Promise<SessionGateSignInResult>
  createAccount: (displayName: string, password: string) => Promise<SessionGateCreateResult>
  setProfilePassword: (userId: string, password: string) => Promise<SessionGateSignInResult>
  setKeepSignedIn: (value: boolean) => void
  completeProviderSetup: () => void
  skipProviderSetup: () => void
  markProviderConnected: (provider: ChatProvider) => void
  clearProviderConnected: (provider: ChatProvider) => void
  reopenProviderSetup: () => void
  signOut: () => void
}

function unlockSession(
  settings: OnboardingSettings,
  userId: string,
  keepSignedIn: boolean
): OnboardingSettings {
  const withUser = patchLocalUser(settings, userId, { keepSignedIn })
  const user = findLocalUser(withUser, userId)
  return {
    ...withUser,
    activeUserId: userId,
    sessionUnlocked: true,
    phase: phaseForUser(user, true)
  }
}

function initialSettings(): OnboardingSettings {
  const stored = readOnboardingSettings(window.localStorage) ?? {
    phase: 'gate' as const,
    users: [],
    activeUserId: null,
    sessionUnlocked: false
  }
  const activeUser = findLocalUser(stored, stored.activeUserId)
  if (stored.sessionUnlocked && activeUser && !activeUser.keepSignedIn) {
    return { ...stored, phase: 'gate', sessionUnlocked: false, activeUserId: null }
  }
  if (activeUser?.keepSignedIn && stored.activeUserId && !stored.sessionUnlocked) {
    return ensureActiveSessionProfile({
      ...stored,
      sessionUnlocked: true,
      phase: phaseForUser(activeUser, true)
    })
  }
  if (stored.sessionUnlocked && activeUser) {
    return { ...stored, phase: phaseForUser(activeUser, true) }
  }
  return ensureActiveSessionProfile(stored)
}

function bootstrapOnboardingSettings(): OnboardingSettings {
  const next = initialSettings()
  const before = readOnboardingSettings(window.localStorage)
  if (
    before !== null
    && (next.activeUserId !== before.activeUserId || next.users.length !== before.users.length || next.phase !== before.phase)
  ) {
    writeOnboardingSettings(window.localStorage, next)
  }
  return next
}

export function useOnboarding(chatSnapshot: ChatSnapshot, legacyBypass: boolean): OnboardingController {
  const [settings, setSettings] = useState(bootstrapOnboardingSettings)
  const [pendingKeepSignedIn, setPendingKeepSignedIn] = useState(true)

  const activeUser = useMemo(
    () => findLocalUser(settings, settings.activeUserId),
    [settings]
  )

  const connectedProviders = activeUser?.connectedProviders ?? []

  const keepSignedIn = settings.sessionUnlocked
    ? (activeUser?.keepSignedIn ?? true)
    : pendingKeepSignedIn

  const persist = useCallback((next: OnboardingSettings) => {
    setSettings(next)
    writeOnboardingSettings(window.localStorage, next)
  }, [])

  useEffect(() => {
    if (readOnboardingSettings(window.localStorage) !== null) return
    if (!legacyBypass) return
    persist(completedOnboardingSettings())
  }, [legacyBypass, persist])

  useEffect(() => {
    setSettings((current) => {
      const next = ensureActiveSessionProfile(current)
      if (next.activeUserId === current.activeUserId && next.users.length === current.users.length) return current
      writeOnboardingSettings(window.localStorage, next)
      return next
    })
  }, [])

  const signIn = useCallback(async (userId: string, password: string): Promise<SessionGateSignInResult> => {
    const current = readOnboardingSettings(window.localStorage) ?? settings
    const user = current.users.find((entry) => entry.id === userId)
    if (!user) return { ok: false, reason: 'unknown-user' }
    if (!user.passwordHash) return { ok: false, reason: 'password-required' }
    if (!password) return { ok: false, reason: 'wrong-password' }
    const valid = await verifyLocalProfilePassword(password, user.passwordHash)
    if (!valid) return { ok: false, reason: 'wrong-password' }
    setSettings(() => {
      const next = unlockSession(current, userId, pendingKeepSignedIn)
      writeOnboardingSettings(window.localStorage, next)
      return next
    })
    return { ok: true }
  }, [pendingKeepSignedIn, settings])

  const setProfilePassword = useCallback(async (userId: string, password: string): Promise<SessionGateSignInResult> => {
    if (!password.trim()) return { ok: false, reason: 'wrong-password' }
    const current = readOnboardingSettings(window.localStorage) ?? settings
    const user = current.users.find((entry) => entry.id === userId)
    if (!user) return { ok: false, reason: 'unknown-user' }
    if (user.passwordHash) return { ok: false, reason: 'wrong-password' }
    const passwordHash = await hashLocalProfilePassword(password)
    const users = current.users.map((entry) => (
      entry.id === userId ? { ...entry, passwordHash } : entry
    ))
    setSettings(() => {
      const next = unlockSession({ ...current, users }, userId, pendingKeepSignedIn)
      writeOnboardingSettings(window.localStorage, next)
      return next
    })
    return { ok: true }
  }, [pendingKeepSignedIn, settings])

  const createAccount = useCallback(async (displayName: string, password: string): Promise<SessionGateCreateResult> => {
    const trimmed = displayName.trim()
    if (!trimmed) return { ok: false, reason: 'name-required' }
    if (!password) return { ok: false, reason: 'password-required' }
    if (password.length < 4) return { ok: false, reason: 'password-too-short' }
    const current = readOnboardingSettings(window.localStorage) ?? settings
    const id = crypto.randomUUID()
    const passwordHash = await hashLocalProfilePassword(password)
    const user = createLocalUser(trimmed, id, passwordHash)
    setSettings(() => {
      const next = unlockSession(
        { ...current, users: [...current.users, user] },
        id,
        pendingKeepSignedIn
      )
      writeOnboardingSettings(window.localStorage, next)
      return next
    })
    return { ok: true }
  }, [pendingKeepSignedIn, settings])

  const setKeepSignedIn = useCallback((value: boolean) => {
    setPendingKeepSignedIn(value)
    if (!settings.sessionUnlocked || !settings.activeUserId) return
    setSettings((current) => {
      const next = patchLocalUser(current, current.activeUserId!, { keepSignedIn: value })
      writeOnboardingSettings(window.localStorage, next)
      return next
    })
  }, [settings.activeUserId, settings.sessionUnlocked])

  const finishProviders = useCallback(() => {
    setSettings((current) => {
      const userId = current.activeUserId
      if (!userId) return current
      const patched = patchLocalUser(current, userId, { providerSetupComplete: true })
      const user = findLocalUser(patched, userId)
      const next: OnboardingSettings = {
        ...patched,
        phase: phaseForUser(user, current.sessionUnlocked)
      }
      writeOnboardingSettings(window.localStorage, next)
      return next
    })
  }, [])

  const completeProviderSetup = finishProviders
  const skipProviderSetup = finishProviders

  const markProviderConnected = useCallback((provider: ChatProvider) => {
    setSettings((current) => {
      const userId = current.activeUserId
      if (!userId) return current
      const user = findLocalUser(current, userId)
      if (!user || user.connectedProviders.includes(provider)) return current
      const next = patchLocalUser(current, userId, {
        connectedProviders: [...user.connectedProviders, provider]
      })
      writeOnboardingSettings(window.localStorage, next)
      return next
    })
  }, [])

  const clearProviderConnected = useCallback((provider: ChatProvider) => {
    setSettings((current) => {
      const userId = current.activeUserId
      if (!userId) return current
      const user = findLocalUser(current, userId)
      if (!user) return current
      const next = patchLocalUser(current, userId, {
        connectedProviders: user.connectedProviders.filter((entry) => entry !== provider)
      })
      writeOnboardingSettings(window.localStorage, next)
      return next
    })
  }, [])

  const reopenProviderSetup = useCallback(() => {
    setSettings((current) => {
      const userId = current.activeUserId
      if (!userId) return current
      const patched = patchLocalUser(current, userId, { providerSetupComplete: false })
      const next: OnboardingSettings = {
        ...patched,
        phase: 'providers',
        sessionUnlocked: true
      }
      writeOnboardingSettings(window.localStorage, next)
      return next
    })
  }, [])

  const signOut = useCallback(() => {
    setSettings((current) => {
      const next = signOutSession(current)
      writeOnboardingSettings(window.localStorage, next)
      return next
    })
  }, [])

  const showSessionGate = useMemo(() => settings.phase === 'gate' && !settings.sessionUnlocked, [settings])

  const showProviderSetup = useMemo(() => {
    if (settings.phase !== 'providers') return false
    return settings.sessionUnlocked
  }, [settings])

  useEffect(() => {
    if (chatSnapshot.provider === 'codex' && chatSnapshot.connection.state === 'ready') {
      markProviderConnected('codex')
    }
  }, [chatSnapshot.connection.state, chatSnapshot.provider, markProviderConnected])

  return {
    settings,
    activeUser,
    connectedProviders,
    keepSignedIn,
    showSessionGate,
    showProviderSetup,
    signIn,
    setProfilePassword,
    createAccount,
    setKeepSignedIn,
    completeProviderSetup,
    skipProviderSetup,
    markProviderConnected,
    clearProviderConnected,
    reopenProviderSetup,
    signOut
  }
}
