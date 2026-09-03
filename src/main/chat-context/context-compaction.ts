import { recordOf } from '../chat-normalizers.js'

// App-driven context compaction. The app-server replays a thread's whole history (every
// tool result and screenshot) on every turn and only compacts by itself near the window
// limit. This watches the usage it reports and asks for compaction earlier, between turns,
// so long UI sessions keep a working-set-sized context instead of a nearly full one.

export type ContextUsage = {
  /** Tokens the last model request occupied, excluding reasoning output. */
  usedTokens: number
  contextWindow: number
}

export type ContextCompactorDeps = {
  thresholdPercent: () => number
  thresholdTokens?: () => number
  /** Injectable clock and grace period for deterministic policy tests. */
  now?: () => number
  idleDelayMs?: number
  threadId: () => string | null
  /** True while the app-server has a turn open; compaction runs as one. */
  turnActive: () => boolean
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>
  notice: (text: string, tone: 'info' | 'error') => void
}

const COMPACT_METHOD = 'thread/compact/start'
/** Compaction is one model call; well past this it is safer to unblock sends than wait. */
const COMPACTION_TIMEOUT_MS = 90_000
const TOKEN_COMPACTION_IDLE_MS = 15_000
const TOKEN_COMPACTION_COOLDOWN_MS = 5 * 60_000

/** Shape of the app-server's `thread/tokenUsage/updated` payload. */
export function parseTokenUsage(value: unknown): ContextUsage | null {
  const usage = recordOf(value)
  const last = recordOf(usage?.last)
  const contextWindow = usage?.modelContextWindow
  if (!last || typeof contextWindow !== 'number' || !(contextWindow > 0)) return null
  const total = numberOf(last.totalTokens)
  const reasoning = numberOf(last.reasoningOutputTokens)
  const usedTokens = Math.max(0, total - reasoning)
  return usedTokens > 0 ? { usedTokens, contextWindow } : null
}

export function usagePercent(usage: ContextUsage): number {
  return Math.min(100, Math.max(0, Math.round((usage.usedTokens / usage.contextWindow) * 100)))
}

/** The latest usage with its percentage, in the shape the transcript snapshot carries. */
export function describeUsage(usage: ContextUsage | null): (ContextUsage & { percent: number }) | null {
  return usage ? { ...usage, percent: usagePercent(usage) } : null
}

export class ContextCompactor {
  private usage: ContextUsage | null = null
  private pending: { promise: Promise<void>; settle: () => void } | null = null
  // Set when a turn other than our own compaction finishes; one compaction per such turn
  // at most, so a compaction that does not shrink the history cannot loop.
  private armed = false
  private scheduled: NodeJS.Timeout | null = null
  private lastTokenAttempt: { at: number; tokens: number; budget: number } | null = null

  constructor(private readonly deps: ContextCompactorDeps) {}

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

  /** Call when the app-server reports a turn finished. May start a compaction. */
  turnFinished(): void {
    if (this.pending) {
      this.settle()
      return
    }
    this.armed = true
    this.checkAfterTurn()
  }

  /**
   * Call when the app-server reports its history was compacted. When the compaction ran
   * as a turn, that turn's completion (which follows this) releases the wait, so a send
   * cannot slip in between the two and be refused for a turn still being open.
   */
  compacted(): void {
    if (!this.deps.turnActive()) this.settle()
  }

  /** Resolves once no compaction is in flight, so a send never races the compaction turn. */
  idle(): Promise<void> {
    return this.pending?.promise ?? Promise.resolve()
  }

  /** User input wins over a not-yet-started idle compaction. An active one must finish. */
  prepareForSend(): Promise<void> {
    this.cancelScheduled()
    this.armed = false
    return this.idle()
  }

  turnStarted(): void {
    this.cancelScheduled()
  }

  /** Forget the thread: switching or losing it invalidates the usage and any wait. */
  reset(): void {
    this.cancelScheduled()
    this.settle()
    this.usage = null
    this.armed = false
    this.lastTokenAttempt = null
  }

  private checkAfterTurn(): void {
    this.cancelScheduled()
    const reason = this.trigger()
    if (!reason) return
    if (reason === 'percent') {
      void this.maybeStart()
      return
    }
    this.scheduled = setTimeout(() => {
      this.scheduled = null
      void this.maybeStart()
    }, this.deps.idleDelayMs ?? TOKEN_COMPACTION_IDLE_MS)
    this.scheduled.unref?.()
  }

  private trigger(): 'percent' | 'tokens' | null {
    if (!this.armed || this.pending || !this.usage || !this.deps.threadId() || this.deps.turnActive()) return null
    const percent = this.deps.thresholdPercent()
    if (percent > 0 && usagePercent(this.usage) >= percent) return 'percent'
    const budget = this.deps.thresholdTokens?.() ?? 0
    if (budget <= 0 || this.usage.usedTokens < budget) return null
    const last = this.lastTokenAttempt
    if (last && last.budget === budget) {
      const growth = this.usage.usedTokens - last.tokens
      if (this.now() - last.at < TOKEN_COMPACTION_COOLDOWN_MS || growth < Math.max(4_000, budget * 0.25)) return null
    }
    return 'tokens'
  }

  private async maybeStart(): Promise<void> {
    const reason = this.trigger()
    const threadId = this.deps.threadId()
    if (!reason || !threadId || !this.usage) return
    const percent = usagePercent(this.usage)
    this.armed = false
    const budget = this.deps.thresholdTokens?.() ?? 0
    if (budget > 0) this.lastTokenAttempt = { at: this.now(), tokens: this.usage.usedTokens, budget }
    const pending = this.begin()
    this.deps.notice(reason === 'tokens'
      ? `Context has ${this.usage.usedTokens} tokens (target ${budget}); compacting older history while idle`
      : `Context is at ${percent}% of the model window; compacting older history`, 'info')
    try {
      await this.deps.request(COMPACT_METHOD, { threadId })
    } catch (error) {
      // An old RPC rejection must not settle a new thread's compaction after reset.
      if (this.pending !== pending) return
      this.deps.notice(`Could not compact the conversation: ${error instanceof Error ? error.message : String(error)}`, 'error')
      this.settle()
    }
  }

  private begin(): NonNullable<ContextCompactor['pending']> {
    let settle: () => void = () => {}
    const promise = new Promise<void>((resolve) => { settle = resolve })
    const timer = setTimeout(() => { if (this.pending === pending) this.settle() }, COMPACTION_TIMEOUT_MS)
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

  private settle(): void {
    const pending = this.pending
    this.pending = null
    pending?.settle()
  }
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
