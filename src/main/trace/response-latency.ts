import type { ChatEvent } from '../../shared/chat.js'
import type { TraceInput, TraceScope } from './trace-log.js'

type Request = {
  scope: TraceScope
  startedAt: number
  dispatchedAt: number | null
  compactionWaitMs: number
  assistantIds: Set<string>
  firstText: boolean
}

/** Main-process receipt timing, not provider token-generation or renderer-paint timing. */
export class ResponseLatency {
  private readonly requests = new Map<string, Request>()

  constructor(
    private readonly record: (scope: TraceScope, input: TraceInput) => unknown,
    private readonly now: () => number = () => performance.now()
  ) {}

  begin(scope: TraceScope): (() => void) | null {
    if (!scope.paneId || this.requests.has(scope.paneId)) return null
    // Abandoned requests must not turn this diagnostic into an unbounded session store.
    if (this.requests.size >= 256) this.requests.delete(this.requests.keys().next().value!)
    const request: Request = {
      scope: { ...scope, turnId: null }, startedAt: this.now(), dispatchedAt: null,
      compactionWaitMs: 0, assistantIds: new Set(), firstText: false
    }
    const paneId = scope.paneId
    this.requests.set(paneId, request)
    return () => { if (this.requests.get(paneId) === request) this.requests.delete(paneId) }
  }

  /** Called from actual outgoing transport traces, never from a compaction turn.start. */
  outgoing(scope: TraceScope, input: TraceInput): void {
    if (input.kind !== 'raw' || input.direction !== 'out') return
    const dispatched = (input.label === 'codex.out' && /^turn\/start(?:\s|$)/.test(input.summary))
      || (input.label === 'claude.out' && input.summary === 'user message')
      || (input.label === 'agy.out' && input.summary === 'user turn')
      || (input.label === 'cursor.out' && /^session\/prompt(?:\s|$)/.test(input.summary))
    const request = scope.paneId ? this.requests.get(scope.paneId) : null
    if (!dispatched || !request || request.dispatchedAt !== null || request.scope.provider !== scope.provider) return
    request.dispatchedAt = this.now()
    request.scope.turnId = scope.turnId
  }

  waitForCompaction(paneId: string | null): () => void {
    const request = paneId ? this.requests.get(paneId) : null
    const startedAt = this.now()
    let finished = false
    return () => {
      if (finished) return
      finished = true
      if (request) request.compactionWaitMs += Math.max(0, this.now() - startedAt)
    }
  }

  event(paneId: string, event: ChatEvent): void {
    const request = this.requests.get(paneId)
    // Session replay and background/compaction turns before dispatch aren't the response.
    if (!request || request.dispatchedAt === null) return
    if (event.type === 'turn') {
      if (event.turnId) {
        request.scope.turnId ??= event.turnId
      } else {
        if (!request.firstText) this.report(request, 'response.no_text')
        this.requests.delete(paneId)
      }
      return
    }
    if (request.firstText) return
    if (event.type === 'item') {
      const item = event.item
      if (item.type !== 'assistant' || !item.turnId) return
      if (request.scope.turnId && request.scope.turnId !== item.turnId) return
      request.scope.turnId ??= item.turnId
      // Only ids in the current request, before its first text; never retain transcript text.
      if (request.assistantIds.size < 256) request.assistantIds.add(item.id)
      if (item.text.trim()) this.firstText(request)
    } else if (event.type === 'itemDelta' && event.field === 'text'
      && request.assistantIds.has(event.itemId) && event.delta.trim()) {
      this.firstText(request)
    }
  }

  clear(): void {
    this.requests.clear()
  }

  forget(paneId: string): void {
    this.requests.delete(paneId)
  }

  private firstText(request: Request): void {
    request.firstText = true
    request.assistantIds.clear()
    this.report(request, 'response.first_text')
  }

  private report(request: Request, label: 'response.first_text' | 'response.no_text'): void {
    const elapsedMs = Math.max(0, this.now() - request.startedAt)
    const preparationMs = Math.max(0, request.dispatchedAt! - request.startedAt)
    this.record(request.scope, {
      kind: 'turn', label,
      summary: label === 'response.first_text'
        ? `First assistant text after ${(elapsedMs / 1_000).toFixed(2)}s`
        : 'Request ended without assistant text',
      durationMs: elapsedMs,
      detail: {
        elapsedMs, preparationMs,
        compactionWaitMs: Math.min(preparationMs, request.compactionWaitMs),
        afterDispatchMs: Math.max(0, elapsedMs - preparationMs),
        measurement: 'main-process receipt; excludes renderer paint; includes commentary'
      }
    })
  }
}
