/**
 * Security settings: the user's manual choices in Settings → Security. Every default equals the
 * unrestricted behavior the app has always had, so a user who never opens the tab sees no prompt,
 * no block, and no change. Hardening that needs no choice (bridge auth, secret redaction, store
 * corruption handling, the sandbox) is not configurable and does not appear here.
 */

/** What a web page gets when it asks for camera, microphone, screen, location, or notifications. */
export type WebPermissionPolicy = 'allow' | 'ask' | 'block'

export type SecuritySettings = {
  /** Show an approval card in the chat before an agent reads a saved credential's secret fields. */
  credentialsRequireApproval: boolean
  /** Refuse to save a secret when the OS keychain cannot encrypt it, instead of storing it plainly. */
  secretsRequireKeychain: boolean
  /** Browser permission requests from web pages. `allow` is the historical auto-grant. */
  webPermissions: WebPermissionPolicy
  /** Import signed-in sites from the default Chromium-family browser on first launch. */
  importBrowserCookies: boolean
}

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  credentialsRequireApproval: false,
  secretsRequireKeychain: false,
  webPermissions: 'allow',
  importBrowserCookies: true
}

const WEB_PERMISSION_POLICIES: readonly WebPermissionPolicy[] = ['allow', 'ask', 'block']

/** Coerce stored or renderer-supplied values to a complete settings record. */
export function normalizeSecuritySettings(value: unknown): SecuritySettings {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const bool = (key: keyof SecuritySettings): boolean =>
    typeof record[key] === 'boolean' ? (record[key] as boolean) : (DEFAULT_SECURITY_SETTINGS[key] as boolean)
  const policy = record.webPermissions
  return {
    credentialsRequireApproval: bool('credentialsRequireApproval'),
    secretsRequireKeychain: bool('secretsRequireKeychain'),
    webPermissions: WEB_PERMISSION_POLICIES.includes(policy as WebPermissionPolicy)
      ? (policy as WebPermissionPolicy)
      : DEFAULT_SECURITY_SETTINGS.webPermissions,
    importBrowserCookies: bool('importBrowserCookies')
  }
}

/** The user's answer to either kind of request. */
export type SecurityDecision = 'allow' | 'deny'

/** Shown as a card in the requesting chat while `credentialsRequireApproval` is on. */
export type CredentialApprovalRequest = {
  id: string
  /** The chat whose agent asked; null when the caller is not a pane. */
  paneId: string | null
  credentialId: string
  credentialLabel: string
  serviceName: string
  fieldIds: string[]
  /** The agent's stated reason, untrusted text shown verbatim. */
  reason: string
  requestedAt: number
}

/** The permissions a page can ask for that the `ask` policy routes to the browser chrome. */
export type WebPermissionKind = 'media' | 'display-capture' | 'geolocation' | 'notifications'

/** Shown as a bar in the browser chrome while `webPermissions` is `ask`. */
export type WebPermissionRequest = {
  id: string
  tabId: string
  origin: string
  permission: WebPermissionKind
  requestedAt: number
}

/** Result of a manual cookie import from Settings → Security. */
export type BrowserCookieImportResult = {
  /** Browser profile the cookies came from; null when no supported browser was found. */
  source: string | null
  imported: number
  failed: number
  skipped: number
}
