import type { WebContents } from 'electron'

export type CdpEventRecord = {
  cursor: number
  at: number
  method: string
  params: unknown
  sessionId: string | null
}

export type CdpEventPage = {
  connectionId: string
  oldestCursor: number
  nextCursor: number
  missedEvents: boolean
  events: CdpEventRecord[]
}

const EVENT_CAPACITY = 1_000
const MAX_EVENT_CHARS = 64_000
const EVENT_PREVIEW_CHARS = 8_000

/** One lazy Electron debugger attachment and its bounded event history. */
export class CdpSession {
  readonly connectionId = crypto.randomUUID()
  private readonly events: CdpEventRecord[] = []
  private nextCursor = 1
  private attachedByUs = false
  private disposed = false

  constructor(
    readonly tabId: string,
    readonly contents: WebContents,
    private readonly onClosed: (session: CdpSession) => void = () => {}
  ) {
    contents.debugger.on('message', this.onMessage)
    contents.debugger.on('detach', this.onDetach)
    contents.on('destroyed', this.onDestroyed)
  }

  get contentsId(): number {
    return this.contents.id
  }

  ensureAttached(): void {
    this.assertLive()
    if (this.contents.debugger.isAttached()) return
    this.contents.debugger.attach()
    this.attachedByUs = true
  }

  async command(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    this.ensureAttached()
    return this.contents.debugger.sendCommand(method, params, sessionId)
  }

  eventPage(afterCursor: number, limit: number, methodPrefix?: string): CdpEventPage {
    this.ensureAttached()
    const oldestCursor = this.events[0]?.cursor ?? this.nextCursor
    const cursorReset = afterCursor >= this.nextCursor && afterCursor > 0
    const effectiveAfter = cursorReset ? 0 : afterCursor
    const events: CdpEventRecord[] = []
    let scannedCursor = Math.max(effectiveAfter, oldestCursor - 1)
    for (const event of this.events) {
      if (event.cursor <= effectiveAfter) continue
      scannedCursor = event.cursor
      if (!methodPrefix || event.method.startsWith(methodPrefix)) events.push(event)
      if (events.length === limit) break
    }
    return {
      connectionId: this.connectionId,
      oldestCursor,
      nextCursor: scannedCursor,
      missedEvents: cursorReset || effectiveAfter < oldestCursor - 1,
      events
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.contents.debugger.off('message', this.onMessage)
    this.contents.debugger.off('detach', this.onDetach)
    this.contents.off('destroyed', this.onDestroyed)
    if (this.attachedByUs && !this.contents.isDestroyed() && this.contents.debugger.isAttached()) {
      this.contents.debugger.detach()
    }
  }

  private readonly onMessage = (
    _event: Electron.Event,
    method: string,
    params: unknown,
    sessionId?: string
  ): void => {
    this.push(method, boundedParams(params), sessionId ?? null)
  }

  private readonly onDetach = (_event: Electron.Event, reason: string): void => {
    this.attachedByUs = false
    this.push('closedai.debuggerDetached', { reason }, null)
  }

  private readonly onDestroyed = (): void => {
    if (this.disposed) return
    this.disposed = true
    this.contents.debugger.off('message', this.onMessage)
    this.contents.debugger.off('detach', this.onDetach)
    this.contents.off('destroyed', this.onDestroyed)
    this.onClosed(this)
  }

  private push(method: string, params: unknown, sessionId: string | null): void {
    if (this.disposed) return
    this.events.push({ cursor: this.nextCursor++, at: Date.now(), method, params, sessionId })
    if (this.events.length > EVENT_CAPACITY) this.events.splice(0, this.events.length - EVENT_CAPACITY)
  }

  private assertLive(): void {
    if (this.disposed || this.contents.isDestroyed()) throw new Error(`Browser tab ${this.tabId} is closed`)
  }
}

function boundedParams(params: unknown): unknown {
  try {
    const serialized = JSON.stringify(params ?? {})
    if (serialized.length <= MAX_EVENT_CHARS) return params ?? {}
    return {
      _closedaiTruncated: true,
      originalChars: serialized.length,
      jsonPreview: serialized.slice(0, EVENT_PREVIEW_CHARS)
    }
  } catch {
    return { _closedaiTruncated: true, jsonPreview: String(params) }
  }
}
