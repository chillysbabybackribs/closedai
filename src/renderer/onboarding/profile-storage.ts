import { ONBOARDING_STORAGE_KEY } from '../../shared/onboarding.js'
import type { ProfileBootstrap, ProfileRemoveResult, ProfileWriteResult } from '../../shared/local-profiles.js'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export type ProfileBridge = {
  bootstrap: () => ProfileBootstrap
  write: (onboarding: string) => ProfileWriteResult
  remove: (userId: string) => Promise<ProfileRemoveResult>
}

export type ProfileStorage = StorageLike & {
  /** The account whose workspace this window shows; null until the first account exists. */
  currentUserId: () => string | null
  /** True when this launch continues a sign-in that began before the relaunch. */
  resumed: () => boolean
  /** Delete an account and its workspace; the stored list is the one main answers with. */
  remove: (userId: string) => Promise<ProfileRemoveResult>
}

/**
 * The account list lives with main, outside every profile's data: localStorage belongs to one
 * profile, and the gate must list every account whichever profile is open. The list an earlier
 * build kept in localStorage is handed to main once and then removed.
 */
export function createProfileStorage(
  bridge: ProfileBridge,
  legacy: Pick<Storage, 'getItem' | 'removeItem'>
): ProfileStorage {
  const boot = bridge.bootstrap()
  let onboarding = boot.onboarding
  let currentUserId = boot.currentUserId

  const write = (value: string): void => {
    onboarding = value
    currentUserId = bridge.write(value).currentUserId
  }

  if (onboarding === null) {
    const stored = legacy.getItem(ONBOARDING_STORAGE_KEY)
    if (stored) write(stored)
  }
  if (onboarding !== null) legacy.removeItem(ONBOARDING_STORAGE_KEY)

  return {
    getItem: (key) => (key === ONBOARDING_STORAGE_KEY ? onboarding : null),
    setItem: (key, value) => { if (key === ONBOARDING_STORAGE_KEY) write(value) },
    currentUserId: () => currentUserId,
    resumed: () => boot.resumed,
    remove: async (userId) => {
      const result = await bridge.remove(userId)
      onboarding = result.onboarding
      currentUserId = result.currentUserId
      return result
    }
  }
}

let shared: ProfileStorage | null = null

/** The window's one account store, opened on first use. */
export function profileStorage(): ProfileStorage {
  return shared ??= createProfileStorage(window.closedai.profiles, window.localStorage)
}
