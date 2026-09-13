import { type ContextUsage, usagePercent } from './context-compaction.js'

// Invisible session rotation: same idle thresholds as compaction, but the provider thread is
// reset with a thin seed on the next send instead of calling native compact.

export type SessionRotatorDeps = {
  enabled: () => boolean
  thresholdPercent: () => number
  thresholdTokens?: () => number
  now?: () => number
  idleDelayMs?: number
  threadId: () => string | null
  turnActive: () => boolean
  rotate: () => Promise<void>
}

const ROTATION_IDLE_MS = 15_000
const ROTATION_TIMEOUT_MS = 90_000
const TOKEN_ROTATION_COOLDOWN_MS = 5 * 60_000

export class SessionRotator {
  private usage: ContextUsage | null = null
  private pending: { promise: Promise<void>; settle: () => void } | null = null
  private armed = false
  private scheduled: NodeJS.Timeout | null = null
  private lastTokenAttempt: { at: number; tokens: number; budget: number } | null = null

  constructor(private readonly deps: SessionRotatorDeps) {}

  get current(): ContextUsage | null {
    return this.usage
  }

  get inFlight(): boolean {
    return this.pending !== null
  }

  get scheduledForIdle(): boolean {
    return this.scheduled !== null
  }

  noteUsage(usage: ContextUsage): void {
    this.usage = usage
    if (this.lastTokenAttempt) this.lastTokenAttempt.tokens = Math.min(this.lastTokenAttempt.tokens, usage.usedTokens)
  }

  turnFinished(): void {
    if (this.pending) {
      this.settle()
      return
    }
    this.armed = true
    this.checkAfterTurn()
  }

  idle(): Promise<void> {
    return this.pending?.promise ?? Promise.resolve()
  }

  prepareForSend(): Promise<void> {
    this.cancelScheduled()
    this.armed = false
    return this.idle()
  }

  turnStarted(): void {
    this.cancelScheduled()
  }

  reset(): void {
    this.cancelScheduled()
    this.settle()
    this.usage = null
    this.armed = false
    this.lastTokenAttempt = null
  }

  private checkAfterTurn(): void {
    this.cancelScheduled()
    if (!this.trigger()) return
    this.scheduled = setTimeout(() => {
      this.scheduled = null
      void this.maybeStart()
    }, this.deps.idleDelayMs ?? ROTATION_IDLE_MS)
    this.scheduled.unref?.()
  }

  private trigger(): 'percent' | 'tokens' | null {
    if (!this.deps.enabled() || !this.armed || this.pending || !this.usage || !this.deps.threadId() || this.deps.turnActive()) return null
    const percent = this.deps.thresholdPercent()
    if (percent > 0 && usagePercent(this.usage) >= percent) return 'percent'
    const budget = this.deps.thresholdTokens?.() ?? 0
    if (budget <= 0 || this.usage.usedTokens < budget) return null
    const last = this.lastTokenAttempt
    if (last && last.budget === budget) {
      const growth = this.usage.usedTokens - last.tokens
      if (this.now() - last.at < TOKEN_ROTATION_COOLDOWN_MS || growth < Math.max(4_000, budget * 0.25)) return null
    }
    return 'tokens'
  }

  private async maybeStart(): Promise<void> {
    const reason = this.trigger()
    if (!reason || !this.deps.threadId() || !this.usage) return
    this.armed = false
    const budget = this.deps.thresholdTokens?.() ?? 0
    if (budget > 0) this.lastTokenAttempt = { at: this.now(), tokens: this.usage.usedTokens, budget }
    const pending = this.begin()
    try {
      await this.deps.rotate()
    } catch (error) {
      if (this.pending !== pending) return
      console.warn('[session-rotation] rotation failed:', error instanceof Error ? error.message : String(error))
      this.settle()
    }
  }

  private begin(): NonNullable<SessionRotator['pending']> {
    let settle: () => void = () => {}
    const promise = new Promise<void>((resolve) => { settle = resolve })
    const timer = setTimeout(() => { if (this.pending === pending) this.settle() }, ROTATION_TIMEOUT_MS)
    timer.unref?.()
    const pending = {
      promise,
      settle: () => {
        clearTimeout(timer)
        settle()
      }
    }
    this.pending = pending
    return pending
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private cancelScheduled(): void {
    if (this.scheduled) clearTimeout(this.scheduled)
    this.scheduled = null
  }

  /** Call after a successful rotation so sends blocked on idle() can proceed. */
  complete(): void {
    this.settle()
  }

  private settle(): void {
    const pending = this.pending
    this.pending = null
    pending?.settle()
  }
}
