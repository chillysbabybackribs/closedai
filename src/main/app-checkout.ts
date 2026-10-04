/** ClosedAI checkout root (Electron `app.getAppPath()`), set during bootstrap. */
let checkoutPath: string | null = null

export function setAppCheckoutPath(path: string): void {
  checkoutPath = path
}

export function appCheckoutPath(): string {
  if (!checkoutPath) throw new Error('App checkout path is not initialized')
  return checkoutPath
}

/** Same as `appCheckoutPath` before bootstrap (tests) or when checkout is unset. */
export function appCheckoutPathOrNull(): string | null {
  return checkoutPath
}
