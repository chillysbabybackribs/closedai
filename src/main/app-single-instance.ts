// One Electron main per resolved userData profile. Different CodeApp profiles remain
// independent because Electron scopes its ProcessSingleton lock to userData; two launches
// aimed at the same profile cannot both reach app readiness.

export type SingleInstanceApp = {
  requestSingleInstanceLock(additionalData?: Record<string, unknown>): boolean
  on(
    event: 'second-instance',
    listener: (event: unknown, argv: string[], cwd: string, additionalData: unknown) => void
  ): unknown
  quit(): void
}

export type FocusableAppWindow = {
  isMinimized(): boolean
  restore(): void
  focus(): void
}

export type AppInstanceIdentity = {
  profile: string
  checkout: string
  pid: number
}

/**
 * Claim the resolved profile before app readiness. A losing process exits without opening
 * stores or Chromium; the existing owner is surfaced rather than replaced or restarted.
 *
 * Electron contract: https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata
 */
export function claimProfileInstance(
  app: SingleInstanceApp,
  identity: AppInstanceIdentity,
  primaryWindow: () => FocusableAppWindow | null
): boolean {
  if (!app.requestSingleInstanceLock(identity)) {
    app.quit()
    return false
  }

  app.on('second-instance', () => {
    const window = primaryWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  return true
}
