import type { BrowserCoordination } from './coordination.js'

/** Same order of magnitude as idle provider parking: brief gaps between turns keep assignments. */
export const DEFAULT_BROWSER_ASSIGNMENT_IDLE_MS = 5 * 60 * 1000

export type BrowserAssignmentIdleGuard = () => boolean

/** Drop tab assignments after a chat stops running long enough, and immediately on detach. */
export class BrowserAssignmentIdleRelease {
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly guards = new Map<string, BrowserAssignmentIdleGuard>()

  constructor(
    private readonly coordination: BrowserCoordination,
    private readonly isActive: (paneId: string) => boolean,
    private readonly idleMs = DEFAULT_BROWSER_ASSIGNMENT_IDLE_MS
  ) {}

  schedule(paneId: string, guard?: BrowserAssignmentIdleGuard): void {
    this.cancel(paneId)
    if (guard) this.guards.set(paneId, guard)
    const timer = setTimeout(() => {
      this.timers.delete(paneId)
      const blocked = this.guards.get(paneId)
      this.guards.delete(paneId)
      if (this.isActive(paneId) || blocked?.()) return
      this.coordination.releaseAll(paneId)
    }, this.idleMs)
    timer.unref?.()
    this.timers.set(paneId, timer)
  }

  cancel(paneId: string): void {
    const timer = this.timers.get(paneId)
    if (timer) clearTimeout(timer)
    this.timers.delete(paneId)
    this.guards.delete(paneId)
  }

  detach(paneId: string): void {
    this.cancel(paneId)
    this.coordination.releaseAll(paneId)
  }

  dispose(): void {
    for (const paneId of this.timers.keys()) this.cancel(paneId)
  }
}
