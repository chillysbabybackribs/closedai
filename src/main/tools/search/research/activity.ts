import type { ResearchActivity, ResearchActivityEvent } from '../../../../shared/web-research.js'
import type { ResearchOwner } from './service.js'
import type { ResearchSnapshot, ResearchSource, ResearchState } from '../../../../shared/web-research.js'

/** The run fields the user-facing view is derived from; the service owns the rest. */
export type ActivityRun = {
  id: string; owner: ResearchOwner; state: ResearchState; pending: number
  startedAt: number; finishedAt?: number; queries: string[]; completedQueries: number
  sources: Map<string, ResearchSource>; errors: ResearchSnapshot['errors']
  presentation: { snapshot(): ResearchSnapshot['presentation'] }
}

const COALESCE_MS = 80

export function toActivity(run: ActivityRun): ResearchActivity {
  const counts = { queued: 0, reading: 0, ready: 0, failed: 0 }
  const sources = [...run.sources.values()].map((source) => {
    counts[source.state] += 1
    return {
      id: source.id, url: source.url, title: source.title, state: source.state, discoveredBy: [...source.discoveredBy],
      ...(source.error ? { error: source.error } : {}), ...(source.chars !== undefined ? { chars: source.chars } : {}),
      ...(source.incomplete ? { incomplete: true } : {}), ...(source.retrievedAt ? { retrievedAt: source.retrievedAt } : {})
    }
  })
  return {
    runId: run.id, paneId: run.owner.paneId, threadId: run.owner.threadId, turnId: run.owner.turnId,
    state: run.state, startedAt: run.startedAt, ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    queries: [...run.queries], completedQueries: run.completedQueries, pending: run.pending,
    counts, sources, errors: run.errors.slice(-12), presentation: run.presentation.snapshot()
  }
}

/** Renderer-facing publication. Bursts of provider results coalesce into one event per run; state
 *  transitions flush immediately so a finished run never waits behind the coalescing window. */
export class ActivityPublisher {
  private readonly listeners = new Set<(event: ResearchActivityEvent) => void>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  subscribe(listener: (event: ResearchActivityEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  schedule(run: ActivityRun): void {
    if (!this.listeners.size || this.timers.has(run.id)) return
    const timer = setTimeout(() => { this.timers.delete(run.id); this.emit({ type: 'run', run: toActivity(run) }) }, COALESCE_MS)
    timer.unref?.()
    this.timers.set(run.id, timer)
  }

  flush(run: ActivityRun): void {
    const timer = this.timers.get(run.id)
    if (timer) { clearTimeout(timer); this.timers.delete(run.id) }
    if (this.listeners.size) this.emit({ type: 'run', run: toActivity(run) })
  }

  evicted(runId: string): void {
    const timer = this.timers.get(runId)
    if (timer) { clearTimeout(timer); this.timers.delete(runId) }
    if (this.listeners.size) this.emit({ type: 'evicted', runId })
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.listeners.clear()
  }

  private emit(event: ResearchActivityEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }
}
