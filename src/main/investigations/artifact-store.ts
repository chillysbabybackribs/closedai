import { Worker } from 'node:worker_threads'
import type { ArtifactLimits, ArtifactScope } from '../../shared/investigation-artifacts.js'
import type { ArtifactRequest } from './artifact-database.js'

type Pending = { resolve(value: unknown): void; reject(error: Error): void; release(): void }

/** Bounded asynchronous facade. Storage/reads/hash verification run off the Electron thread. */
export class ArtifactStore {
  private readonly worker: Worker
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private queuedBytes = 0
  private failure: Error | null = null
  private closing: Promise<void> | null = null

  constructor(file: string, options: { workerUrl: URL; limits?: ArtifactLimits }) {
    this.worker = new Worker(options.workerUrl, { workerData: { file, limits: options.limits } })
    this.worker.on('message', (message: { requestId: number; error?: string; result?: unknown }) => {
      const pending = this.pending.get(message.requestId)
      if (!pending) return
      this.pending.delete(message.requestId)
      pending.release()
      if (message.error) pending.reject(new Error(message.error))
      else pending.resolve(message.result)
    })
    this.worker.on('error', (error) => this.fail(error))
    this.worker.on('exit', () => this.fail(new Error('Artifact worker closed; an interrupted operation may have committed. Reuse its operation key.')))
  }

  request<T>(action: ArtifactRequest['action'], scope: ArtifactScope, input: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    if (this.failure) return Promise.reject(this.failure)
    if (this.closing && action !== 'close') return Promise.reject(new Error('Artifact store is closing'))
    if (signal?.aborted) return Promise.reject(new Error('Artifact operation cancelled'))
    const bytes = input.bytes instanceof Uint8Array ? input.bytes.byteLength : 0
    if (action !== 'close' && (this.pending.size >= 16 || this.queuedBytes + bytes > 64 * 1024 * 1024)) {
      return Promise.reject(new Error('Artifact queue is full; retry after pending operations settle'))
    }
    const requestId = this.nextId++
    const cancellation = new SharedArrayBuffer(4)
    const flag = new Int32Array(cancellation)
    const cancel = (): void => { Atomics.compareExchange(flag, 0, 0, 1) }
    signal?.addEventListener('abort', cancel, { once: true })
    this.queuedBytes += bytes
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (value) => {
          if (value && typeof value === 'object' && signal?.aborted && Atomics.load(flag, 0) === 2) {
            Object.assign(value, { cancellationTiming: 'after-commit-admission' })
          }
          resolve(value as T)
        },
        reject,
        release: () => {
          this.queuedBytes -= bytes
          signal?.removeEventListener('abort', cancel)
        }
      })
      try {
        this.worker.postMessage({ requestId, action, scope, input, cancellation } satisfies ArtifactRequest & { requestId: number })
      } catch (error) {
        this.pending.get(requestId)?.release()
        this.pending.delete(requestId)
        reject(error)
      }
    })
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closing = this.request('close', { chatId: '', workspace: '' }, {})
        .then(() => undefined)
        .finally(() => this.worker.terminate().then(() => undefined))
    }
    return this.closing
  }

  private fail(error: Error): void {
    this.failure = error
    for (const pending of this.pending.values()) {
      pending.release()
      pending.reject(error)
    }
    this.pending.clear()
  }
}
