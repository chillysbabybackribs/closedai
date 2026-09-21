import { createHash } from 'node:crypto'
import { MAX_DURATION_MS, type ProbeRequest, type ProbeResult } from './contracts.js'
import type { NativeControllerClient } from './client.js'

type Operation = { hash: string; targetId: string; result?: ProbeResult; promise: Promise<ProbeResult> }

/** Results survive provider rotation within this app lifetime. Never evict a key and rerun it. */
export class NativeInstrumentService {
  private readonly operations = new Map<string, Operation>()
  private readonly busyTargets = new Set<string>()
  private readonly active = new Set<AbortController>()
  private disposed = false

  constructor(private readonly client: Pick<NativeControllerClient, 'run' | 'dispose'>) {}

  run(owner: string, key: string, request: ProbeRequest, signal: AbortSignal, isCurrent = () => true): Promise<ProbeResult> {
    if (this.disposed) throw new Error('Native instrumentation is closed')
    if (!owner || !/^[\w.-]{1,100}$/.test(key)) throw new Error('A caller and a stable operation_key are required')
    if (typeof request.source !== 'string' || request.source.length > 20_000 ||
        !Number.isInteger(request.durationMs) || request.durationMs < 0 || request.durationMs > MAX_DURATION_MS) {
      throw new Error('Invalid probe source or duration')
    }
    signal.throwIfAborted()
    if (!isCurrent()) throw new Error('Native instrumentation requires the caller’s current active turn')
    const id = JSON.stringify([owner, key])
    const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    const previous = this.operations.get(id)
    if (previous) {
      if (previous.hash !== hash) throw new Error('operation_key already names different arguments')
      return previous.promise
    }
    if (this.operations.size >= 256) throw new Error('Native operation receipt capacity reached for this app lifetime')
    if (this.busyTargets.has(request.targetId)) throw new Error('This target already has an active native operation')
    if (this.active.size >= 2) throw new Error('Two native controllers are already active')
    const abort = new AbortController()
    const cancel = () => abort.abort(new Error('Native operation owner cancelled'))
    signal.addEventListener('abort', cancel, { once: true })
    const monitor = setInterval(() => { if (!isCurrent()) cancel() }, 100)
    this.active.add(abort)
    this.busyTargets.add(request.targetId)
    const operation: Operation = { hash, targetId: request.targetId, promise: Promise.resolve().then(async () => {
      try {
        operation.result = await this.client.run(request, abort.signal)
        return operation.result
      } finally {
        clearInterval(monitor)
        signal.removeEventListener('abort', cancel)
        this.active.delete(abort)
        this.busyTargets.delete(request.targetId)
      }
    }) }
    this.operations.set(id, operation)
    return operation.promise
  }

  read(owner: string, key: string) {
    const operation = this.operations.get(JSON.stringify([owner, key]))
    if (!operation) return { state: 'not-found', note: 'Receipts do not survive app restart; absence does not establish that a prior probe never ran.' }
    return operation.result ?? { state: 'running', targetId: operation.targetId }
  }

  dispose(): void {
    this.disposed = true
    for (const abort of this.active) abort.abort(new Error('Native instrumentation stopped'))
    this.client.dispose()
  }
}
