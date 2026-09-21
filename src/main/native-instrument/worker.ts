import { runProbe } from './controller.js'
import { CONTROLLER_DEADLINE_MS, MAX_DURATION_MS, type ControllerMessage } from './contracts.js'

const abort = new AbortController()
let running = false
// Independent deadline also applies if main vanishes or stops responding.
setTimeout(() => abort.abort(new Error('Controller lease expired')), CONTROLLER_DEADLINE_MS - 4_000)
setTimeout(() => process.exit(2), CONTROLLER_DEADLINE_MS)
process.on('disconnect', () => abort.abort(new Error('Controller owner disconnected')))
process.on('SIGTERM', () => abort.abort(new Error('Controller stopped')))
process.on('message', (message: ControllerMessage) => {
  if (message.type === 'cancel') { abort.abort(new Error('Operation cancelled')); return }
  if (message.type !== 'run' || running) return
  running = true
  const request = message.request
  if (!request || typeof request.source !== 'string' || request.source.length > 20_000 ||
      !Number.isInteger(request.durationMs) || request.durationMs < 0 || request.durationMs > MAX_DURATION_MS) {
    process.exit(2)
  }
  void runProbe(request, abort.signal).then(result => {
    if (!process.connected) process.exit(0)
    process.send?.({ type: 'result', result }, () => process.exit(0))
  }).catch(() => process.exit(2))
})
process.send?.({ type: 'ready' })
