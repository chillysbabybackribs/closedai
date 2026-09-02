import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createInterface, type Interface as ReadLineInterface } from 'node:readline'

export type RpcId = number | string

type RpcSuccess = { id: RpcId; result: unknown }
export type AppServerNotification = { method: string; params?: unknown }
export type AppServerRequest = { id: RpcId; method: string; params?: unknown }

type PendingRequest = {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class AppServerRpcError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly data: unknown
  ) {
    super(message)
    this.name = 'AppServerRpcError'
  }
}

export class AppServerClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private lines: ReadLineInterface | null = null
  private nextId = 1
  private readonly pending = new Map<RpcId, PendingRequest>()
  private stopping = false

  constructor(
    private readonly executable: string,
    private readonly cwd: string,
    /** Extra `codex app-server` arguments, read at each spawn so a restart picks up changes. */
    private readonly launchArgs: () => string[] = () => []
  ) {
    super()
  }

  async start(): Promise<void> {
    if (this.child) return
    this.stopping = false
    const child = spawn(this.executable, ['app-server', ...this.launchArgs(), '--listen', 'stdio://'], {
      cwd: this.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    this.lines.on('line', (line) => this.receiveLine(line))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const text = chunk.trim()
      if (text) console.warn('[app-server]', text)
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
        reject(new Error(`Could not start ${this.executable}: ${error.message}`))
      }
      child.once('spawn', onSpawn)
      child.once('error', onError)
    })
    child.on('error', (error) => {
      if (!this.stopping) this.emit('protocolError', new Error(`Codex app-server process error: ${error.message}`))
    })
    child.stdin.on('error', (error) => {
      if (!this.stopping) this.emit('protocolError', new Error(`Codex app-server input error: ${error.message}`))
    })

    try {
      await this.request('initialize', {
        clientInfo: { name: 'closedai', title: 'ClosedAI', version: '0.1.0' },
        capabilities: {
          // Opts in to experimental fields such as thread/start `dynamicTools` (tools/).
          experimentalApi: true,
          requestAttestation: false,
          optOutNotificationMethods: []
        }
      })
      this.notify('initialized', {})
    } catch (error) {
      this.stop()
      throw error
    }
  }

  request<T>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
    const child = this.child
    if (!child || child.stdin.destroyed) return Promise.reject(new Error('Codex app-server is not connected'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex app-server request timed out: ${method}`))
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
    this.rejectPending(new Error('Codex app-server stopped'))
    if (child && child.exitCode === null && !child.killed) child.kill('SIGTERM')
  }

  private write(message: unknown): void {
    const child = this.child
    if (!child || child.stdin.destroyed || !child.stdin.writable) throw new Error('Codex app-server is not connected')
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private receiveLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    let message: unknown
    try {
      message = JSON.parse(trimmed)
    } catch {
      this.emit('protocolError', new Error('Codex app-server returned invalid JSON'))
      return
    }
    const record = asRecord(message)
    if (!record) return
    const id = typeof record.id === 'number' || typeof record.id === 'string' ? record.id : null
    const method = typeof record.method === 'string' ? record.method : null

    if (id !== null && ('result' in record || 'error' in record) && this.pending.has(id)) {
      const pending = this.pending.get(id)!
      this.pending.delete(id)
      clearTimeout(pending.timer)
      if ('error' in record) {
        const error = asRecord(record.error)
        pending.reject(new AppServerRpcError(
          typeof error?.message === 'string' ? error.message : `${pending.method} failed`,
          typeof error?.code === 'number' ? error.code : null,
          error?.data
        ))
      } else {
        pending.resolve((record as RpcSuccess).result)
      }
      return
    }
    if (method && id !== null) {
      this.emit('request', { id, method, params: record.params } satisfies AppServerRequest)
      return
    }
    if (method) this.emit('notification', { method, params: record.params } satisfies AppServerNotification)
  }

  private handleExit(child: ChildProcessWithoutNullStreams, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child) return
    this.child = null
    this.lines?.close()
    this.lines = null
    const detail = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`
    this.rejectPending(new Error(`Codex app-server exited with ${detail}`))
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
