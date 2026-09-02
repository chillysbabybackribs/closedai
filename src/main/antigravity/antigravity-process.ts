import { spawn, type ChildProcess } from 'node:child_process'

// One live `agy` process: stream-json turns in over stdin, NDJSON events out over stdout.
// Spawned in its own process group so that stopping a turn reaches the shell commands and
// sandboxes the CLI forks, not just the CLI; there is no stdin interrupt in the protocol, so a
// stop is a kill and the conversation resumes in a fresh process (`--conversation <id>`).

export type AntigravityProcessOptions = {
  binary: string
  args: readonly string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  onEvent: (raw: unknown) => void
  /** The process is gone; `stderr` is the bounded tail the CLI wrote. */
  onExit: (info: { code: number | null; signal: NodeJS.Signals | null; stderr: string }) => void
  onSpawnError: (message: string) => void
}

const KILL_GRACE_MS = 3_000

export class AntigravityProcess {
  private readonly child: ChildProcess
  private readonly buffer: NdjsonLineBuffer
  private stderrTail = ''
  private exited = false
  private terminating: Promise<void> | null = null

  constructor(options: AntigravityProcessOptions) {
    this.buffer = new NdjsonLineBuffer((raw) => options.onEvent(raw))
    this.child = spawn(options.binary, [...options.args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    })
    this.child.stdout?.setEncoding('utf8')
    this.child.stdout?.on('data', (chunk: string) => this.buffer.push(chunk))
    this.child.stderr?.setEncoding('utf8')
    this.child.stderr?.on('data', (chunk: string) => { this.stderrTail = (this.stderrTail + chunk).slice(-4_000) })
    this.child.on('error', (error: NodeJS.ErrnoException) => {
      if (this.exited) return
      this.exited = true
      options.onSpawnError(error.code === 'ENOENT' ? `The Antigravity CLI (${options.binary}) was not found` : error.message)
    })
    this.child.on('close', (code, signal) => {
      if (this.exited) return
      this.exited = true
      this.buffer.flush()
      options.onExit({ code, signal, stderr: this.stderrTail.trim() })
    })
  }

  get alive(): boolean {
    return !this.exited && this.child.exitCode === null && this.child.signalCode === null
  }

  /** Queue one stdin line (a turn). */
  write(line: string): void {
    const stdin = this.child.stdin
    if (!this.alive || !stdin || stdin.destroyed || !stdin.writable) throw new Error('Antigravity is not running')
    stdin.write(line)
  }

  /** TERM the process group, KILL whatever survives the grace period, and wait for the exit. */
  terminate(): Promise<void> {
    this.terminating ??= this.doTerminate()
    return this.terminating
  }

  private async doTerminate(): Promise<void> {
    if (!this.alive) return
    const exited = new Promise<void>((resolve) => this.child.once('close', () => resolve()))
    this.signal('SIGTERM')
    const timer = setTimeout(() => this.signal('SIGKILL'), KILL_GRACE_MS)
    await exited
    clearTimeout(timer)
  }

  private signal(signal: NodeJS.Signals): void {
    const pid = this.child.pid
    if (!pid || !this.alive) return
    try {
      if (process.platform !== 'win32') process.kill(-pid, signal)
      else this.child.kill(signal)
    } catch {
      try { this.child.kill(signal) } catch { /* already gone */ }
    }
  }
}

/** Incremental NDJSON framing: stdout chunks split objects at arbitrary byte boundaries. */
export class NdjsonLineBuffer {
  private buffer = ''

  constructor(private readonly onLine: (value: unknown) => void) {}

  push(chunk: string): void {
    this.buffer += chunk
    let newline = this.buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line) this.emitLine(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  flush(): void {
    const line = this.buffer.trim()
    this.buffer = ''
    if (line) this.emitLine(line)
  }

  private emitLine(line: string): void {
    try {
      this.onLine(JSON.parse(line))
    } catch {
      // A non-JSON line is diagnostic noise, not a turn failure.
    }
  }
}
