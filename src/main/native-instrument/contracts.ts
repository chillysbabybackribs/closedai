/** Only the external controller imports Frida's native binding. */
export const FRIDA_VERSION = '17.18.0'
export const MAX_DURATION_MS = 10_000
export const CONTROLLER_DEADLINE_MS = 18_000

export type NativeTarget = { id: string; pid: number; name: string; executable: string }
export type ProbeRequest = { targetId: string; source: string; durationMs: number }
export type ProbeEvent = {
  sequence: number
  elapsedMs: number
  message: unknown
  binary?: { base64: string; originalBytes: number; truncated: boolean }
}
export type ProbeResult = {
  state: 'completed' | 'failed' | 'cancelled' | 'unknown'
  targetId: string
  sourceHash: string
  fridaVersion: string
  elapsedMs: number
  events: ProbeEvent[]
  received: number
  dropped: number
  truncated: number
  cleanup: { script: string; session: string; deviceManager?: string }
  error?: string
}
export type ControllerMessage = { type: 'run'; request: ProbeRequest } | { type: 'cancel' }
export type ControllerReply = { type: 'ready' } | { type: 'result'; result: ProbeResult }
