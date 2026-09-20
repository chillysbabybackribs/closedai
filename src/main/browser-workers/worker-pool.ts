import { RequestBudget } from '../tools/search/request-budget.js'

/** The subset of a browser tab a hidden worker needs; BrowserTab satisfies it. */
export type Worker = {
  readonly id: string
  navigate(url: string): Promise<void>
  dispose(): void
  alive(): boolean
}

// Three hidden Chromium renderers is the process-wide ceiling for background page reads; two
// per owner so one run cannot monopolise them. Idle workers are torn down so finished research
// does not keep renderer processes alive.
export const WORKER_CAPACITY = 3
const PER_OWNER = 2
const IDLE_MS = 30_000

/**
 * Hidden page workers leased per read. Owners never hold a worker across reads: a lease spans
 * one navigation and extraction, then the worker returns to the pool or is reaped when idle.
 * Aborting the lease signal releases a queued or in-flight lease, which is how a finished run
 * gives its workers back.
 */
export class BrowserWorkerPool {
  private readonly idle: Array<{ worker: Worker; timer: ReturnType<typeof setTimeout> }> = []
  private readonly budget: RequestBudget
  private busy = 0
  private disposed = false

  constructor(
    private readonly create: () => Worker,
    private readonly capacity = WORKER_CAPACITY,
    private readonly idleMs = IDLE_MS
  ) {
    this.budget = new RequestBudget(capacity, PER_OWNER)
  }

  /** Workers alive right now, leased or idle. */
  get size(): number { return this.busy + this.idle.length }

  async lease<T>(owner: string, signal: AbortSignal, operation: (worker: Worker) => Promise<T>): Promise<T> {
    if (this.disposed) throw new Error('Browser workers are shut down')
    return this.budget.run(owner, owner, signal, async () => {
      if (this.disposed) throw new Error('Browser workers are shut down')
      const worker = this.take()
      try {
        return await operation(worker)
      } finally {
        this.give(worker)
      }
    })
  }

  dispose(): void {
    this.disposed = true
    for (const entry of this.idle.splice(0)) {
      clearTimeout(entry.timer)
      entry.worker.dispose()
    }
  }

  private take(): Worker {
    this.busy += 1
    while (this.idle.length) {
      const entry = this.idle.pop()!
      clearTimeout(entry.timer)
      if (entry.worker.alive()) return entry.worker
      entry.worker.dispose()
    }
    return this.create()
  }

  private give(worker: Worker): void {
    this.busy -= 1
    if (this.disposed || !worker.alive()) { worker.dispose(); return }
    const timer = setTimeout(() => {
      const index = this.idle.findIndex((entry) => entry.worker === worker)
      if (index >= 0) this.idle.splice(index, 1)[0]!.worker.dispose()
    }, this.idleMs)
    timer.unref?.()
    this.idle.push({ worker, timer })
  }
}
