import { randomUUID } from 'node:crypto'
import type { SecurityDecision } from '../shared/security.js'

type Pending<T> = { request: T; settle: (allowed: boolean) => void; timer: ReturnType<typeof setTimeout> }

/**
 * A user decision awaited by main-process code: the request sits in a pending list the renderer
 * mirrors, resolves when the user answers or the caller withdraws it, and denies itself after
 * the timeout so an unanswered card never holds a tool call open forever.
 */
export class DecisionBroker<T extends { id: string; requestedAt: number }> {
  readonly #pending = new Map<string, Pending<T>>()
  readonly #listeners = new Set<(pending: T[]) => void>()

  constructor(private readonly timeoutMs: number, private readonly now: () => number = Date.now) {}

  /** Resolves true only on an explicit allow; deny, timeout, and withdrawal all resolve false. */
  ask(fields: Omit<T, 'id' | 'requestedAt'>, signal?: AbortSignal): Promise<boolean> {
    const request = { ...fields, id: randomUUID(), requestedAt: this.now() } as T
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.resolve(request.id, 'deny'), this.timeoutMs)
      timer.unref?.()
      this.#pending.set(request.id, { request, settle: resolve, timer })
      signal?.addEventListener('abort', () => this.resolve(request.id, 'deny'), { once: true })
      this.#emit()
    })
  }

  /** Unknown ids are ignored: the request already timed out or was withdrawn. */
  resolve(id: string, decision: SecurityDecision): void {
    const entry = this.#pending.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    this.#pending.delete(id)
    entry.settle(decision === 'allow')
    this.#emit()
  }

  pending(): T[] {
    return [...this.#pending.values()].map((entry) => ({ ...entry.request }))
  }

  onChange(listener: (pending: T[]) => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  #emit(): void {
    const snapshot = this.pending()
    for (const listener of this.#listeners) listener(snapshot)
  }
}
