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
  threadId: () => string | null
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>
  notice: (text: string, tone: 'info' | 'error') => void
}

const COMPACT_METHOD = 'thread/compact/start'
/** Compaction is one model call; well past this it is safer to unblock sends than wait. */
const COMPACTION_TIMEOUT_MS = 90_000

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

  constructor(private readonly deps: ContextCompactorDeps) {}

  get current(): ContextUsage | null {
    return this.usage
  }

  get inFlight(): boolean {
    return this.pending !== null
  }

  noteUsage(usage: ContextUsage): void {
    this.usage = usage
  }

  /** Call when the app-server reports a turn finished. May start a compaction. */
  turnFinished(): void {
    if (this.pending) {
      this.settle()
      return
    }
    this.armed = true
    void this.maybeStart()
  }

  /** Call when the app-server reports its history was compacted. */
  compacted(): void {
    this.settle()
  }

  /** Resolves once no compaction is in flight, so a send never races the compaction turn. */
  idle(): Promise<void> {
    return this.pending?.promise ?? Promise.resolve()
  }

  /** Forget the thread: switching or losing it invalidates the usage and any wait. */
  reset(): void {
    this.settle()
    this.usage = null
    this.armed = false
  }

  private async maybeStart(): Promise<void> {
    const threshold = this.deps.thresholdPercent()
    const threadId = this.deps.threadId()
    if (threshold <= 0 || !threadId || !this.usage || !this.armed) return
    const percent = usagePercent(this.usage)
    if (percent < threshold) return
    this.armed = false
    this.begin()
    this.deps.notice(`Context is at ${percent}% of the model window; compacting older history`, 'info')
    try {
      await this.deps.request(COMPACT_METHOD, { threadId })
    } catch (error) {
      this.deps.notice(`Could not compact the conversation: ${error instanceof Error ? error.message : String(error)}`, 'error')
      this.settle()
    }
  }

  private begin(): void {
    let settle: () => void = () => {}
    const promise = new Promise<void>((resolve) => { settle = resolve })
    const timer = setTimeout(() => this.settle(), COMPACTION_TIMEOUT_MS)
    timer.unref?.()
    this.pending = {
      promise,
      settle: () => {
        clearTimeout(timer)
        settle()
      }
    }
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
