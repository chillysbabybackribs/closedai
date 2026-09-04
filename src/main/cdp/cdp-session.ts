import type { WebContents } from 'electron'

import { nullableString, recordOf } from '../json-coerce.js'

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

export type CdpTargetRecord = {
  targetId: string
  type: string
  title: string
  url: string
  attached: boolean
  sessionId: string | null
  openerId: string | null
  subtype: string | null
  waitingForDebugger: boolean
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
  private targetDiscoveryReady = false
  private targetSetup: Promise<void> | null = null
  private attachmentEpoch = 0
  private readonly targets = new Map<string, CdpTargetRecord>()
  private readonly targetIdBySession = new Map<string, string>()

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
    await this.ensureTargetDiscovery()
    const result = await this.contents.debugger.sendCommand(method, params, sessionId)
    this.recordTargetCommand(method, params, result)
    return result
  }

  /** The durable child-target catalog for this root tab's current debugger connection. */
  targetInventory(): CdpTargetRecord[] {
    return [...this.targets.values()]
      .map((target) => ({ ...target }))
      .sort((left, right) => left.targetId.localeCompare(right.targetId))
  }

  eventPage(afterCursor: number, limit: number, methodPrefix?: string): CdpEventPage {
    this.ensureAttached()
    void this.ensureTargetDiscovery()
    const oldestCursor = this.events[0]?.cursor ?? this.nextCursor
    const cursorReset = afterCursor >= this.nextCursor && afterCursor > 0
    const effectiveAfter = cursorReset ? 0 : afterCursor
    const events: CdpEventRecord[] = []
    let scannedCursor = Math.max(effectiveAfter, oldestCursor - 1)
    for (const event of this.events) {
      if (event.cursor <= effectiveAfter) continue
      scannedCursor = event.cursor
      if (!methodPrefix || event.method.startsWith(methodPrefix)) {
        events.push({ ...event, params: boundedParams(event.params) })
      }
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
    this.attachmentEpoch += 1
    this.targetSetup = null
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
    this.recordTargetEvent(method, params)
    this.push(method, params, sessionId ?? null)
  }

  private readonly onDetach = (_event: Electron.Event, reason: string): void => {
    this.attachedByUs = false
    this.targetDiscoveryReady = false
    this.targetSetup = null
    this.attachmentEpoch += 1
    this.clearTargetSessions()
    this.push('closedai.debuggerDetached', { reason }, null)
  }

  private readonly onDestroyed = (): void => {
    if (this.disposed) return
    this.disposed = true
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

  /**
   * Make child targets usable through the same attachment. Electron's debugger otherwise
   * exposes popup, worker, and OOPIF lifecycle only after a caller manually enables discovery
   * and auto-attach. Flattened sessions keep the existing public contract: the model receives a
   * session_id in the event stream and passes that id to later command calls.
   */
  private ensureTargetDiscovery(): Promise<void> {
    if (this.targetDiscoveryReady) return Promise.resolve()
    if (this.targetSetup) return this.targetSetup
    const epoch = this.attachmentEpoch
    this.targetSetup = Promise.allSettled([
      this.contents.debugger.sendCommand('Target.setDiscoverTargets', { discover: true }),
      this.contents.debugger.sendCommand('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true
      })
    ]).then((results) => {
      const allFulfilled = results.every((r) => r.status === 'fulfilled')
      if (!this.disposed && this.attachmentEpoch === epoch && allFulfilled) this.targetDiscoveryReady = true
    }).finally(() => {
      this.targetSetup = null
    })
    return this.targetSetup
  }

  private recordTargetCommand(method: string, params: Record<string, unknown>, result: unknown): void {
    const record = recordOf(result)
    if (method === 'Target.getTargets') {
      const infos = Array.isArray(record?.targetInfos) ? record.targetInfos : []
      for (const info of infos) this.upsertTarget(info)
      return
    }
    if (method === 'Target.getTargetInfo') {
      this.upsertTarget(record?.targetInfo)
      return
    }
    if (method === 'Target.attachToTarget') {
      const targetId = nullableString(params.targetId)
      const sessionId = nullableString(record?.sessionId)
      if (targetId && sessionId) this.setTargetSession(targetId, sessionId, false)
      return
    }
    if (method === 'Target.detachFromTarget') {
      const sessionId = nullableString(params.sessionId)
      if (sessionId) this.detachTargetSession(sessionId)
    }
  }

  private recordTargetEvent(method: string, params: unknown): void {
    const record = recordOf(params)
    if (!record) return
    if (method === 'Target.targetCreated' || method === 'Target.targetInfoChanged') {
      this.upsertTarget(record.targetInfo)
      return
    }
    if (method === 'Target.targetDestroyed') {
      const targetId = nullableString(record.targetId)
      if (targetId) this.removeTarget(targetId)
      return
    }
    if (method === 'Target.attachedToTarget') {
      const sessionId = nullableString(record.sessionId)
      this.upsertTarget(record.targetInfo, sessionId, Boolean(record.waitingForDebugger))
      return
    }
    if (method === 'Target.detachedFromTarget') {
      const sessionId = nullableString(record.sessionId)
      const targetId = nullableString(record.targetId)
      if (sessionId) this.detachTargetSession(sessionId)
      else if (targetId) this.setTargetSession(targetId, null, false)
    }
  }

  private upsertTarget(value: unknown, sessionId?: string | null, waitingForDebugger?: boolean): void {
    const info = recordOf(value)
    const targetId = nullableString(info?.targetId)
    if (!targetId) return
    const previous = this.targets.get(targetId)
    const nextSession = sessionId === undefined ? previous?.sessionId ?? null : sessionId
    if (previous?.sessionId && previous.sessionId !== nextSession) this.targetIdBySession.delete(previous.sessionId)
    const target: CdpTargetRecord = {
      targetId,
      type: nullableString(info?.type) ?? previous?.type ?? 'other',
      title: nullableString(info?.title) ?? previous?.title ?? '',
      url: nullableString(info?.url) ?? previous?.url ?? '',
      attached: typeof info?.attached === 'boolean' ? info.attached : nextSession !== null,
      sessionId: nextSession,
      openerId: nullableString(info?.openerId) ?? previous?.openerId ?? null,
      subtype: nullableString(info?.subtype) ?? previous?.subtype ?? null,
      waitingForDebugger: waitingForDebugger ?? previous?.waitingForDebugger ?? false
    }
    this.targets.set(targetId, target)
    if (nextSession) this.targetIdBySession.set(nextSession, targetId)
  }

  private setTargetSession(targetId: string, sessionId: string | null, waitingForDebugger: boolean): void {
    const target = this.targets.get(targetId)
    if (!target) return
    if (target.sessionId) this.targetIdBySession.delete(target.sessionId)
    this.targets.set(targetId, { ...target, attached: sessionId !== null, sessionId, waitingForDebugger })
    if (sessionId) this.targetIdBySession.set(sessionId, targetId)
  }

  private detachTargetSession(sessionId: string): void {
    const targetId = this.targetIdBySession.get(sessionId)
    if (!targetId) return
    this.targetIdBySession.delete(sessionId)
    this.setTargetSession(targetId, null, false)
  }

  private removeTarget(targetId: string): void {
    const target = this.targets.get(targetId)
    if (target?.sessionId) this.targetIdBySession.delete(target.sessionId)
    this.targets.delete(targetId)
  }

  private clearTargetSessions(): void {
    this.targetIdBySession.clear()
    for (const [targetId, target] of this.targets) {
      this.targets.set(targetId, { ...target, attached: false, sessionId: null, waitingForDebugger: false })
    }
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
