import { Worker } from 'node:worker_threads'
import type { ChatPaneLexicalIndexRecord } from '../../shared/chat-index.js'
import type { PaneLexicalFtsHit } from './chat-pane-lexical-fts.js'

/** One lazy SQLite owner. Idle workers do not hold shutdown open. */
export class PaneIndexWorker {
  private worker: Worker | null = null
  private sequence = 0
  private closed = false
  private readonly pending = new Map<number, {
    resolve: (rows: PaneLexicalFtsHit[]) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  constructor(private readonly url: URL, private readonly dir: string) {}

  search(record: ChatPaneLexicalIndexRecord, query: string, limit: number): Promise<PaneLexicalFtsHit[]> {
    if (this.closed) return Promise.reject(new Error('Pane index closed'))
    const worker = this.worker ?? this.start()
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(worker, new Error('Pane index worker timed out')), 10_000)
      this.pending.set(id, { resolve, reject, timer })
      worker.ref()
      try { worker.postMessage({ id, record, query, limit }) }
      catch (error) { this.fail(worker, error instanceof Error ? error : new Error(String(error))) }
    })
  }

  close(): void {
    this.closed = true
    if (this.worker) this.fail(this.worker, new Error('Pane index closed'))
  }

  private start(): Worker {
    const worker = new Worker(this.url, { workerData: { dir: this.dir } })
    this.worker = worker
    worker.on('message', (message: { id: number; rows: PaneLexicalFtsHit[]; error?: string }) => {
      if (this.worker !== worker) return
      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)
      clearTimeout(request.timer)
      if (message.error) request.reject(new Error(message.error))
      else request.resolve(message.rows)
      if (!this.pending.size) worker.unref()
    })
    worker.on('error', (error) => this.fail(worker, error))
    worker.on('exit', (code) => this.fail(worker, new Error(`Pane index worker exited (${code})`)))
    worker.unref()
    return worker
  }

  private fail(worker: Worker, error: Error): void {
    if (this.worker !== worker) return
    this.worker = null
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.pending.clear()
    void worker.terminate()
  }
}
