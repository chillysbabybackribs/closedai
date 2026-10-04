/** One title request at a time across every chat. Cancelled waiting jobs never spawn a provider. */
export class TitleQueue {
  private running = false
  private readonly waiting: Array<() => void> = []

  run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T | null> {
    if (signal.aborted) return Promise.resolve(null)
    if (this.waiting.length >= 32) return Promise.reject(new Error('Title queue is full'))
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        const index = this.waiting.indexOf(start)
        if (index < 0) return
        this.waiting.splice(index, 1)
        resolve(null)
      }
      const start = (): void => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) { resolve(null); this.next(); return }
        this.running = true
        // Promise.resolve().then would delay a task that can start now. Start synchronously.
        let work: Promise<T>
        try { work = task() } catch (error) { work = Promise.reject(error) }
        void work.then(resolve, reject).finally(() => this.next())
      }
      if (this.running) {
        this.waiting.push(start)
        signal.addEventListener('abort', abort, { once: true })
      } else start()
    })
  }

  private next(): void {
    this.running = false
    this.waiting.shift()?.()
  }
}
export const titleQueue = new TitleQueue()
