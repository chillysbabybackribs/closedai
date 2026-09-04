/** One admission gate shared by every search run and synchronous query in the registry. */
export class RequestBudget {
  private active = 0
  private readonly byKey = new Map<string, number>()
  private readonly queue: Array<{
    key: string; owner: string; signal: AbortSignal; start(): void; abort(): void
  }> = []
  private lastOwner = ''

  constructor(private readonly limit: number, private readonly perKey: number = limit) {}

  async run<T>(key: string, owner: string, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const entry = {
        key, owner, signal,
        start: () => { signal.removeEventListener('abort', entry.abort); resolve() },
        abort: () => {
          const index = this.queue.indexOf(entry)
          if (index >= 0) this.queue.splice(index, 1)
          reject(signal.reason)
          this.drain()
        }
      }
      this.queue.push(entry)
      signal.addEventListener('abort', entry.abort, { once: true })
      this.drain()
    })
    try {
      signal.throwIfAborted()
      return await operation()
    } finally {
      this.active -= 1
      const count = (this.byKey.get(key) ?? 1) - 1
      if (count) this.byKey.set(key, count)
      else this.byKey.delete(key)
      this.drain()
    }
  }

  private drain(): void {
    while (this.active < this.limit) {
      const eligible = (entry: typeof this.queue[number]) => (this.byKey.get(entry.key) ?? 0) < this.perKey
      let index = this.queue.findIndex((entry) => eligible(entry) && entry.owner !== this.lastOwner)
      if (index < 0) index = this.queue.findIndex(eligible)
      if (index < 0) return
      const entry = this.queue.splice(index, 1)[0]!
      this.lastOwner = entry.owner
      this.active += 1
      this.byKey.set(entry.key, (this.byKey.get(entry.key) ?? 0) + 1)
      entry.start()
    }
  }
}

/** Bounds a non-cooperative transport too; late outcomes are consumed, never published. */
export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Aborted'))
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}
