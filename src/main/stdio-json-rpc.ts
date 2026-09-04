import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createInterface, type Interface as ReadLineInterface } from 'node:readline'
import { ownProcessGroup, stopProcessGroup, trackProcessGroup } from './process-tree.js'
import { traceLog, type TraceScope } from './trace/trace-log.js'

// Newline-delimited JSON-RPC 2.0 over a spawned process's stdio. Two providers speak it: the
// Codex app-server (`codex app-server --listen stdio://`) and the Cursor agent's ACP server
// (`cursor-agent acp`). Both are long-lived processes that answer requests, send their own
// requests back, and stream notifications, so the framing, the pending-request table, and the
// trace tap live here once; each provider's client supplies its spawn arguments and handshake.

export type RpcId = number | string

export type JsonRpcNotification = { method: string; params?: unknown }
export type JsonRpcRequest = { id: RpcId; method: string; params?: unknown }

type PendingRequest = {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/** How a client records the wire in the turn trace; omitted when the peer is not traced. */
export type RpcTrace = {
  scope: () => TraceScope
  /** Trace label per direction, e.g. `codex.in` / `codex.out`. */
  label: (direction: 'in' | 'out') => string
  summarize: (message: unknown) => string
}

export type StdioJsonRpcOptions = {
  /** How errors name this peer, e.g. `Codex app-server`. */
  peer: string
  executable: string
  cwd: string
  /** Read at each spawn so a restart picks up changes. */
  args: () => string[]
  env?: () => NodeJS.ProcessEnv
  trace?: RpcTrace | null
  defaultTimeoutMs?: number
  /**
   * Stamped on every outgoing message as `jsonrpc`. ACP requires `'2.0'`; the Codex app-server
   * accepts bare `{method, id, params}` and has always been spoken to that way, so it is unset
   * there rather than changed underneath a working provider.
   */
  version?: string
}

export class JsonRpcPeerError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly data: unknown
  ) {
    super(message)
    this.name = 'JsonRpcPeerError'
  }
}

export class StdioJsonRpcClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private lines: ReadLineInterface | null = null
  private nextId = 1
  private readonly pending = new Map<RpcId, PendingRequest>()
  protected stopping = false

  constructor(private readonly options: StdioJsonRpcOptions) {
    super()
  }

  get connected(): boolean {
    return this.child !== null && !this.child.stdin.destroyed
  }

  /** Spawn the peer. Any protocol handshake belongs to the subclass that knows it. */
  async start(): Promise<void> {
    if (this.child) return
    this.stopping = false
    const { peer, executable, cwd, args, env } = this.options
    // Its own process group, so stopping it also stops the worker the CLI's launcher forks.
    const child = spawn(executable, args(), {
      cwd,
      env: env ? env() : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...ownProcessGroup()
    })
    trackProcessGroup(child)
    this.child = child
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    this.lines.on('line', (line) => this.receiveLine(line))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const text = chunk.trim()
      if (text) console.warn(`[${peer}]`, text)
    })
    child.on('exit', (code, signal) => this.handleExit(child, code, signal))

    await new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        child.off('error', onError)
        resolve()
      }
      const onError = (error: Error): void => {
        child.off('spawn', onSpawn)
        if (this.child === child) {
          this.child = null
          this.lines?.close()
          this.lines = null
        }
        reject(new Error(`Could not start ${executable}: ${error.message}`))
      }
      child.once('spawn', onSpawn)
      child.once('error', onError)
    })
    child.on('error', (error) => {
      if (!this.stopping) this.emit('protocolError', new Error(`${peer} process error: ${error.message}`))
    })
    child.stdin.on('error', (error) => {
      if (!this.stopping) this.emit('protocolError', new Error(`${peer} input error: ${error.message}`))
    })
  }

  request<T>(method: string, params?: unknown, timeoutMs = this.options.defaultTimeoutMs ?? 30_000): Promise<T> {
    const child = this.child
    if (!child || child.stdin.destroyed) return Promise.reject(new Error(`${this.options.peer} is not connected`))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.options.peer} request timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timer
      })
      try {
        this.write({ method, id, params })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  notify(method: string, params?: unknown): void {
    this.write({ method, params })
  }

  respond(id: RpcId, result: unknown): void {
    this.write({ id, result })
  }

  respondWithError(id: RpcId, code: number, message: string): void {
    this.write({ id, error: { code, message } })
  }

  stop(): void {
    this.stopping = true
    const child = this.child
    this.child = null
    this.lines?.close()
    this.lines = null
    this.rejectPending(new Error(`${this.options.peer} stopped`))
    if (child) stopProcessGroup(child)
  }

  /** The error a failed call rejects with; overridden where a provider's name is asserted on. */
  protected rpcError(message: string, code: number | null, data: unknown): Error {
    return new JsonRpcPeerError(message, code, data)
  }

  private write(message: unknown): void {
    const child = this.child
    if (!child || child.stdin.destroyed || !child.stdin.writable) {
      throw new Error(`${this.options.peer} is not connected`)
    }
    const framed = this.options.version
      ? { jsonrpc: this.options.version, ...(message as Record<string, unknown>) }
      : message
    child.stdin.write(`${JSON.stringify(framed)}\n`)
    this.trace('out', framed)
  }

  private trace(direction: 'in' | 'out', message: unknown): void {
    const trace = this.options.trace
    if (!trace) return
    traceLog.record(trace.scope(), {
      kind: 'raw',
      label: trace.label(direction),
      summary: trace.summarize(message),
      detail: message,
      direction
    })
  }

  private receiveLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    let message: unknown
    try {
      message = JSON.parse(trimmed)
    } catch {
      this.emit('protocolError', new Error(`${this.options.peer} returned invalid JSON`))
      return
    }
    const record = asRecord(message)
    if (!record) return
    this.trace('in', message)
    const id = typeof record.id === 'number' || typeof record.id === 'string' ? record.id : null
    const method = typeof record.method === 'string' ? record.method : null

    if (id !== null && ('result' in record || 'error' in record) && this.pending.has(id)) {
      const pending = this.pending.get(id)!
      this.pending.delete(id)
      clearTimeout(pending.timer)
      if ('error' in record) {
        const error = asRecord(record.error)
        pending.reject(this.rpcError(
          typeof error?.message === 'string' ? error.message : `${pending.method} failed`,
          typeof error?.code === 'number' ? error.code : null,
          error?.data
        ))
      } else {
        pending.resolve(record.result)
      }
      return
    }
    if (method && id !== null) {
      this.emit('request', { id, method, params: record.params } satisfies JsonRpcRequest)
      return
    }
    if (method) this.emit('notification', { method, params: record.params } satisfies JsonRpcNotification)
  }

  private handleExit(child: ChildProcessWithoutNullStreams, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child) return
    this.child = null
    this.lines?.close()
    this.lines = null
    const detail = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`
    this.rejectPending(new Error(`${this.options.peer} exited with ${detail}`))
    if (!this.stopping) this.emit('exit', { code, signal })
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
