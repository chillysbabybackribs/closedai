import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ChatProvider } from '../../shared/chat.js'
import type { ChatSnapshot } from '../../shared/chat.js'
import type { OnboardingSettings } from '../../shared/onboarding.js'
import {
  completedOnboardingSettings,
  createLocalUser,
  readOnboardingSettings,
  writeOnboardingSettings
} from './onboarding-settings.js'

export type OnboardingController = {
  settings: OnboardingSettings
  showSessionGate: boolean
  showProviderSetup: boolean
  signIn: (userId: string) => void
  createAccount: (displayName: string) => void
  setKeepSignedIn: (value: boolean) => void
  completeProviderSetup: () => void
  skipProviderSetup: () => void
  markProviderConnected: (provider: ChatProvider) => void
  clearProviderConnected: (provider: ChatProvider) => void
  reopenProviderSetup: () => void
}

function unlockSession(settings: OnboardingSettings, userId: string, keepSignedIn: boolean): OnboardingSettings {
  return {
    ...settings,
    activeUserId: userId,
    keepSignedIn,
    sessionUnlocked: true,
    phase: settings.providerSetupComplete ? 'done' : 'providers'
  }
}

function initialSettings(): OnboardingSettings {
  const stored = readOnboardingSettings(window.localStorage) ?? {
    phase: 'gate' as const,
    users: [],
    activeUserId: null,
    keepSignedIn: true,
    sessionUnlocked: false,
    connectedProviders: [],
    providerSetupComplete: false
  }
  if (!stored.keepSignedIn && stored.providerSetupComplete && stored.activeUserId) {
    return { ...stored, phase: 'gate', sessionUnlocked: false }
  }
  if (stored.keepSignedIn && stored.activeUserId && stored.phase === 'gate') {
    return {
      ...stored,
      sessionUnlocked: true,
      phase: stored.providerSetupComplete ? 'done' : 'providers'
    }
  }
  return stored
}

export function useOnboarding(chatSnapshot: ChatSnapshot, legacyBypass: boolean): OnboardingController {
  const [settings, setSettings] = useState(initialSettings)

  const persist = useCallback((next: OnboardingSettings) => {
    setSettings(next)
    writeOnboardingSettings(window.localStorage, next)
  }, [])

  useEffect(() => {
    if (readOnboardingSettings(window.localStorage) !== null) return
    if (!legacyBypass) return
    persist(completedOnboardingSettings())
  }, [legacyBypass, persist])

  const signIn = useCallback((userId: string) => {
    setSettings((current) => {
      if (!current.users.some((user) => user.id === userId)) return current
      const next = unlockSession(current, userId, current.keepSignedIn)
      writeOnboardingSettings(window.localStorage, next)
      return next
    })
  }, [])

  const createAccount = useCallback((displayName: string) => {
    setSettings((current) => {
      const id = crypto.randomUUID()
      const user = createLocalUser(displayName, id)
      const next = unlockSession(
        { ...current, users: [...current.users, user] },
        id,
        current.keepSignedIn
      )
      writeOnboardingSettings(window.localStorage, next)
      return next
    })
  }, [])

  const setKeepSignedIn = useCallback((value: boolean) => {
    setSettings((current) => {
      const next = { ...current, keepSignedIn: value }
      writeOnboardingSettings(window.localStorage, next)
      return next
    })
  }, [])

  const finishProviders = useCallback(() => {
    setSettings((current) => {
      const next: OnboardingSettings = {
        ...current,
        phase: 'done',
        providerSetupComplete: true,
        sessionUnlocked: current.keepSignedIn ? true : current.sessionUnlocked
      }
      writeOnboardingSettings(window.localStorage, next)
      return next
    })
  }, [])

  const completeProviderSetup = finishProviders
  const skipProviderSetup = finishProviders

  const markProviderConnected = useCallback((provider: ChatProvider) => {
    setSettings((current) => {
      if (current.connectedProviders.includes(provider)) return current
      const next = {
        ...current,
        connectedProviders: [...current.connectedProviders, provider]
      }
      writeOnboardingSettings(window.localStorage, next)
      return next
    })
  }, [])

  const clearProviderConnected = useCallback((provider: ChatProvider) => {
    setSettings((current) => {
      const next = {
        ...current,
        connectedProviders: current.connectedProviders.filter((entry) => entry !== provider)
      }
      writeOnboardingSettings(window.localStorage, next)
      return next
    })
  }, [])

  const reopenProviderSetup = useCallback(() => {
    setSettings((current) => {
      const next: OnboardingSettings = { ...current, phase: 'providers', providerSetupComplete: false }
      writeOnboardingSettings(window.localStorage, next)
      return next
    })
  }, [])

  const showSessionGate = useMemo(() => settings.phase === 'gate' && !settings.sessionUnlocked, [settings])

  const showProviderSetup = useMemo(() => {
    if (settings.phase !== 'providers') return false
    return settings.sessionUnlocked
  }, [settings])

  // Lift live Codex readiness into connected providers.
  useEffect(() => {
    if (chatSnapshot.provider === 'codex' && chatSnapshot.connection.state === 'ready') {
      markProviderConnected('codex')
    }
  }, [chatSnapshot.connection.state, chatSnapshot.provider, markProviderConnected])

  return {
    settings,
    showSessionGate,
    showProviderSetup,
    signIn,
    createAccount,
    setKeepSignedIn,
    completeProviderSetup,
    skipProviderSetup,
    markProviderConnected,
    clearProviderConnected,
    reopenProviderSetup
  }
}
