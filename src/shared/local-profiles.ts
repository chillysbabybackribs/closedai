/**
 * Local profiles own a whole workspace: each one has its own data directory, so chats, notes,
 * layout, browser session and credentials never cross accounts. Main keeps the account list in
 * one file beside every profile, because the list must be readable before any profile is open.
 */

/** What a renderer needs before its first paint; read synchronously from main. */
export type ProfileBootstrap = {
  /** The profile whose data this process has open; null until the first account exists. */
  currentUserId: string | null
  /** The stored onboarding settings as JSON text; null when no account was ever recorded. */
  onboarding: string | null
  /** True when this launch continues a sign-in that began in the previous process. */
  resumed: boolean
}

/** The answer to a registry write: the write can decide which profile owns the open data. */
export type ProfileWriteResult = {
  currentUserId: string | null
}

/** Profile ids name a directory, so only plain id characters are accepted. */
export function isProfileId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
}
