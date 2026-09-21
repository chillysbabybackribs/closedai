import type { ProbeEvent } from './contracts.js'

/** Bounds retained evidence; it cannot bound Frida's upstream transport or target-side work. */
export class ProbeEvents {
  readonly events: ProbeEvent[] = []
  received = 0
  dropped = 0
  truncated = 0
  private bytes = 0
  private readonly started = performance.now()

  add(message: unknown, data: Buffer | null = null): void {
    const sequence = ++this.received
    if (this.events.length >= 64 || this.bytes >= 10_000) { this.dropped++; return }
    let encoded: string
    try { encoded = JSON.stringify(message) ?? 'null' } catch { this.dropped++; return }
    let shortened = false
    if (encoded.length > 2_000) {
      message = { preview: encoded.slice(0, 1_600), truncated: true, originalCharacters: encoded.length }
      shortened = true
    }
    const event: ProbeEvent = { sequence, elapsedMs: Math.round(performance.now() - this.started), message }
    if (data) {
      event.binary = { base64: data.subarray(0, 512).toString('base64'), originalBytes: data.length, truncated: data.length > 512 }
      shortened ||= data.length > 512
    }
    const size = Buffer.byteLength(JSON.stringify(event))
    if (this.bytes + size > 10_000) { this.dropped++; return }
    if (shortened) this.truncated++
    this.bytes += size
    this.events.push(event)
  }
}
