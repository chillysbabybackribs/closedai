export const DEFAULT_IDLE_MS = 15 * 60 * 1000

/** Close a provider process after idle time when no turn is active. */
export class IdleProcessGuard {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly onIdle: () => void,
    private readonly idleMs = DEFAULT_IDLE_MS
  ) {}

  /** Arm the idle timer when `armed` is true; always clears any prior timer first. */
  schedule(armed: boolean): void {
    this.clear()
    if (!armed) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.onIdle()
    }, this.idleMs)
    this.timer.unref?.()
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
