import { fork, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { CONTROLLER_DEADLINE_MS, FRIDA_VERSION, type ControllerReply, type ProbeRequest, type ProbeResult } from './contracts.js'

export class NativeControllerClient {
  private readonly children = new Set<ChildProcess>()
  private disposed = false

  constructor(private readonly workerUrl: URL, private readonly execPath = process.execPath) {}

  run(request: ProbeRequest, signal: AbortSignal): Promise<ProbeResult> {
    if (this.disposed) throw new Error('Native controller is closed')
    signal.throwIfAborted()
    const started = performance.now()
    // execArgv must not inherit Electron flags, test runners, or the parent's debugger port.
    const child = fork(this.workerUrl, [], {
      execPath: this.execPath, execArgv: [],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    })
    this.children.add(child)
    return new Promise(resolve => {
      let result: ProbeResult | undefined
      let failure = 'Controller exited without a result; target effects and cleanup are unconfirmed'
      let cancellationKill: ReturnType<typeof setTimeout> | undefined
      const hardKill = setTimeout(() => child.kill('SIGKILL'), CONTROLLER_DEADLINE_MS + 1_000)
      const send = (message: object) => {
        if (child.connected) child.send(message, error => { if (error) failure = error.message })
      }
      const cancel = () => {
        send({ type: 'cancel' })
        cancellationKill ??= setTimeout(() => child.kill('SIGKILL'), 2_500)
      }
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
      child.on('error', error => { failure = error.message })
      child.on('message', (reply: ControllerReply) => {
        if (reply.type === 'ready') send(signal.aborted ? { type: 'cancel' } : { type: 'run', request })
        if (reply.type === 'result') result = reply.result
      })
      child.once('close', () => {
        clearTimeout(hardKill)
        clearTimeout(cancellationKill)
        signal.removeEventListener('abort', cancel)
        this.children.delete(child)
        resolve(result ?? {
          state: 'unknown', targetId: request.targetId,
          sourceHash: createHash('sha256').update(request.source).digest('hex'), fridaVersion: FRIDA_VERSION,
          elapsedMs: Math.round(performance.now() - started), events: [], received: 0, dropped: 0, truncated: 0,
          cleanup: { script: 'unconfirmed', session: 'unconfirmed' }, error: failure
        })
      })
    })
  }

  dispose(): void {
    this.disposed = true
    for (const child of this.children) {
      if (child.connected) child.send({ type: 'cancel' }, () => {})
      const timer = setTimeout(() => { if (this.children.has(child)) child.kill('SIGKILL') }, 2_500)
      timer.unref()
    }
  }
}
