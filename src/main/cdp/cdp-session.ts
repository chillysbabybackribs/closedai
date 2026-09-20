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

export type CdpEventListener = (method: string, params: unknown) => void
export type CdpSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>

/**
 * Something a caller wants in every matching child target, now and as they appear: enable a
 * domain, install a script. `apply` runs when a child is attached, before a paused new target
 * resumes, and its value is kept so `release` can undo exactly that child.
 */
export type CdpChildDirective<State = unknown> = {
  /** Target types it applies to, for example iframe or worker. */
  types: readonly string[]
  apply(send: CdpSend, target: CdpTargetRecord): Promise<State>
  release?(send: CdpSend, target: CdpTargetRecord, state: State): Promise<void>
}
export type CdpChildOutcome = {
  sessionId: string
  targetId: string
  type: string
  url: string
  state?: unknown
  error?: string
}

type DirectiveEntry = { key: string; directive: CdpChildDirective; outcomes: Map<string, CdpChildOutcome> }

const EVENT_CAPACITY = 1_000
// Child targets that can host documents and therefore further children.
const DOCUMENT_TARGETS = new Set(['page', 'iframe'])
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
  private readonly observers = new Set<CdpEventListener>()
  private readonly directives = new Map<string, DirectiveEntry>()
  /** Attach-time work per child session, so a release waits for the apply it undoes. */
  private readonly childSetup = new Map<string, Promise<void>>()

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

  /**
   * Hold a directive over every attached child of the listed types until it is released.
   * Returns the outcome per child attached now; later children are handled as they attach and
   * show up in `childOutcomes`.
   */
  async lease<State>(key: string, directive: CdpChildDirective<State>): Promise<CdpChildOutcome[]> {
    await this.release(key)
    this.ensureAttached()
    await this.ensureTargetDiscovery()
    const entry: DirectiveEntry = { key, directive: directive as CdpChildDirective, outcomes: new Map() }
    this.directives.set(key, entry)
    await Promise.all([...this.childSetup.values()])
    const children = [...this.targets.values()].filter((target) => target.sessionId && directive.types.includes(target.type))
    await Promise.all(children.map((target) => this.applyDirective(entry, target)))
    return this.childOutcomes(key)
  }

  /** Undo a leased directive in every child that received it and forget it. */
  async release(key: string): Promise<CdpChildOutcome[]> {
    const entry = this.directives.get(key)
    if (!entry) return []
    this.directives.delete(key)
    await Promise.all([...this.childSetup.values()])
    const released: CdpChildOutcome[] = []
    for (const outcome of entry.outcomes.values()) {
      const target = this.targets.get(outcome.targetId)
      if (outcome.error !== undefined || !entry.directive.release || !target?.sessionId || target.sessionId !== outcome.sessionId) {
        released.push(outcome)
        continue
      }
      try {
        await entry.directive.release(this.childSend(outcome.sessionId), target, outcome.state)
        released.push(this.currentOutcome(outcome))
      } catch (error) {
        released.push({ ...this.currentOutcome(outcome), error: errorMessage(error) })
      }
    }
    return released
  }

  /** Outcomes carry the child's current type and URL, not the ones it attached with. */
  childOutcomes(key: string): CdpChildOutcome[] {
    const entry = this.directives.get(key)
    if (!entry) return []
    return [...entry.outcomes.values()].map((outcome) => this.currentOutcome(outcome))
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId))
  }

  private currentOutcome(outcome: CdpChildOutcome): CdpChildOutcome {
    const target = this.targets.get(outcome.targetId)
    return target ? { ...outcome, type: target.type, url: target.url } : outcome
  }

  /** The durable child-target catalog for this root tab's current debugger connection. */
  targetInventory(): CdpTargetRecord[] {
    return [...this.targets.values()]
      .map((target) => ({ ...target }))
      .sort((left, right) => left.targetId.localeCompare(right.targetId))
  }

  /**
   * Watch this attachment's events from the main process. Used to restore agent state Chromium
   * does not carry into a new document; returns the unsubscribe.
   */
  observe(listener: CdpEventListener): () => void {
    this.observers.add(listener)
    return () => { this.observers.delete(listener) }
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
    this.observers.clear()
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
    for (const observer of [...this.observers]) {
      try {
        observer(method, params)
      } catch {
        // An observer is main-process bookkeeping; it must never break event recording.
      }
    }
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
      // New children start paused so a leased directive lands before their first script; the
      // attach handler always resumes them, directives or not.
      this.contents.debugger.sendCommand('Target.setAutoAttach', AUTO_ATTACH)
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
      if (sessionId) this.onChildAttached(sessionId, Boolean(record.waitingForDebugger))
      return
    }
    if (method === 'Target.detachedFromTarget') {
      const sessionId = nullableString(record.sessionId)
      const targetId = nullableString(record.targetId)
      if (sessionId) this.detachTargetSession(sessionId)
      else if (targetId) this.setTargetSession(targetId, null, false)
    }
  }

  /**
   * A child is usable the moment it attaches: it auto-attaches its own children, receives every
   * leased directive, and only then resumes if it was started paused. Failures are recorded per
   * child, never thrown into the event loop, and never leave a target paused.
   */
  private onChildAttached(sessionId: string, waitingForDebugger: boolean): void {
    const targetId = this.targetIdBySession.get(sessionId)
    const target = targetId ? this.targets.get(targetId) : undefined
    if (!target) return
    const send = this.childSend(sessionId)
    const setup = (async () => {
      try {
        if (DOCUMENT_TARGETS.has(target.type)) await send('Target.setAutoAttach', AUTO_ATTACH).catch(() => undefined)
        const entries = [...this.directives.values()].filter((entry) => entry.directive.types.includes(target.type))
        await Promise.all(entries.map((entry) => this.applyDirective(entry, target)))
      } finally {
        if (waitingForDebugger) await send('Runtime.runIfWaitingForDebugger').catch(() => undefined)
      }
    })().finally(() => { if (this.childSetup.get(sessionId) === setup) this.childSetup.delete(sessionId) })
    this.childSetup.set(sessionId, setup)
  }

  private async applyDirective(entry: DirectiveEntry, target: CdpTargetRecord): Promise<void> {
    const sessionId = target.sessionId
    if (!sessionId) return
    const outcome: CdpChildOutcome = { sessionId, targetId: target.targetId, type: target.type, url: target.url }
    try {
      outcome.state = await entry.directive.apply(this.childSend(sessionId), target)
    } catch (error) {
      outcome.error = errorMessage(error)
    }
    // The directive may have been released, or the child detached, while apply ran.
    if (this.directives.get(entry.key) !== entry) return
    if (this.targetIdBySession.get(sessionId) !== target.targetId) return
    entry.outcomes.set(sessionId, outcome)
  }

  private childSend(sessionId: string): CdpSend {
    return async (method, params = {}) => {
      this.assertLive()
      return this.contents.debugger.sendCommand(method, params, sessionId)
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
    for (const entry of this.directives.values()) entry.outcomes.delete(sessionId)
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
    // Chromium drops the sessions with the connection; a directive is reapplied as they reattach.
    for (const entry of this.directives.values()) entry.outcomes.clear()
  }
}

const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true } as const

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300)
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
