import * as frida from 'frida'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { FRIDA_VERSION, type ProbeRequest, type ProbeResult } from './contracts.js'
import { verifyTarget } from './targets.js'
import { ProbeEvents } from './events.js'

/** One session per helper lifetime. Native binding and callbacks never run in Electron main. */
export async function runProbe(request: ProbeRequest, signal: AbortSignal): Promise<ProbeResult> {
  const started = performance.now()
  const events = new ProbeEvents()
  const pending = new frida.Cancellable()
  const cancel = () => pending.cancel()
  signal.addEventListener('abort', cancel, { once: true })
  let session: frida.Session | undefined
  let script: frida.Script | undefined
  let manager: frida.DeviceManager | undefined
  const result: ProbeResult = {
    state: 'completed', targetId: request.targetId,
    sourceHash: createHash('sha256').update(request.source).digest('hex'), fridaVersion: FRIDA_VERSION,
    elapsedMs: 0, events: events.events, received: 0, dropped: 0, truncated: 0,
    cleanup: { script: 'not-created', session: 'not-attached' }
  }
  try {
    signal.throwIfAborted()
    const target = await verifyTarget(request.targetId)
    manager = new frida.DeviceManager()
    result.cleanup.deviceManager = 'pending'
    const device = await manager.getDeviceByType(frida.DeviceType.Local, 0, pending)
    session = await device.attach(target.pid, {}, pending)
    result.cleanup.session = 'pending'
    await verifyTarget(request.targetId)
    session.detached.connect(reason => {
      if (reason !== 'application-requested' && result.state === 'completed') {
        result.state = 'failed'
        result.error = `Target session detached: ${reason}`
      }
    })
    signal.throwIfAborted()
    script = await session.createScript(request.source, { name: 'closedai-probe' }, pending)
    result.cleanup.script = 'pending'
    script.logHandler = (level, text) => events.add({ type: 'log', level, text })
    script.message.connect((message, data) => {
      events.add(message, data)
      if (message.type === 'error' && result.state === 'completed') {
        result.state = 'failed'
        result.error = 'The agent reported an error; inspect retained events'
      }
    })
    await script.load(pending)
    await delay(request.durationMs, undefined, { signal })
  } catch (error) {
    result.state = signal.aborted ? 'cancelled' : 'failed'
    result.error = String(error).slice(0, 1_000)
  } finally {
    signal.removeEventListener('abort', cancel)
    // Fresh cancellation budgets: the operation's cancellation must not cancel its cleanup.
    if (script) {
      try {
        if (signal.aborted && !script.isDestroyed) {
          await script.interrupt(frida.Cancellable.withTimeout(500)).catch(() => {})
        }
        if (!script.isDestroyed) await script.unload(frida.Cancellable.withTimeout(1_000))
        result.cleanup.script = 'unloaded-or-destroyed'
      } catch (error) { result.cleanup.script = `unconfirmed: ${String(error).slice(0, 300)}` }
    }
    if (session) {
      try {
        if (!session.isDetached()) await session.detach(frida.Cancellable.withTimeout(1_000))
        result.cleanup.session = 'detached'
      } catch (error) { result.cleanup.session = `unconfirmed: ${String(error).slice(0, 300)}` }
    }
    if (manager) {
      try {
        await manager.close(frida.Cancellable.withTimeout(1_000))
        result.cleanup.deviceManager = 'closed'
      } catch (error) { result.cleanup.deviceManager = `unconfirmed: ${String(error).slice(0, 300)}` }
    }
  }
  if (result.state === 'completed') {
    try { await verifyTarget(request.targetId) } catch (error) {
      result.state = 'failed'
      result.error = `Target exited or changed during the experiment: ${String(error).slice(0, 500)}`
    }
  }
  if (Object.values(result.cleanup).some(value => value.startsWith('unconfirmed'))) result.state = 'unknown'
  return Object.assign(result, {
    elapsedMs: Math.round(performance.now() - started), received: events.received,
    dropped: events.dropped, truncated: events.truncated
  })
}
