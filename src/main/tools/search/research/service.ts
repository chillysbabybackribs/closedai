import { randomUUID } from 'node:crypto'
import type { ResearchSnapshot, ResearchSource, ResearchState } from '../../../../shared/web-research.js'
import type { ToolContext } from '../../tool.js'
import { canonicalUrl, SearchRouter } from '../router.js'
import type { SearchRequest, SearchResult } from '../types.js'
import { publicUrl, type SourceDocument, type SourceReader } from './source-reader.js'

export type ResearchOwner = { paneId: string; threadId: string; turnId: string | null; workspace: string }
export type ResearchDependencies = {
  owner(context: ToolContext): ResearchOwner
  collect: SourceReader
  read(runId: string, sourceId: string): Promise<string>
  remove(runId: string): Promise<void>
  /** Opens a retained, user-owned tab once. Never follows subsequent results automatically. */
  openLive?(url: string): string
}
export type ResearchInput = {
  queries: SearchRequest[]; urls: string[]; maxSources: number; deadlineMs: number; presentation: 'live' | 'background'
}
type Run = {
  id: string; owner: ResearchOwner; state: ResearchState; revision: number; pending: number
  completedQueries: number; totalQueries: number; maxSources: number
  sources: Map<string, ResearchSource>; errors: ResearchSnapshot['errors']; controller: AbortController
  listeners: Set<() => void>; timer: ReturnType<typeof setTimeout>
  presentation: ResearchSnapshot['presentation']
}

/** The scheduler owns async work after the start tool returns; calls only observe/control it. */
export class ResearchService {
  private readonly runs = new Map<string, Run>()
  private readonly stoppedTurns = new Map<string, string>()
  private disposed = false

  constructor(private readonly router: SearchRouter, private readonly deps: ResearchDependencies) {}

  start(input: ResearchInput, context: ToolContext): ResearchSnapshot {
    if (this.disposed) throw new Error('Research service is stopped')
    const owner = this.deps.owner(context)
    if (!owner.turnId) throw new Error('Start research during an active turn')
    if (this.stoppedTurns.get(owner.paneId) === `${owner.threadId}:${owner.turnId}`) {
      throw new Error('This turn was stopped; it cannot start more research')
    }
    this.validate(input.queries, input.urls)
    if ([...this.runs.values()].filter((run) => run.state === 'running').length >= 8) {
      throw new Error('Eight research runs are already active; extend an existing run or wait for it')
    }
    this.evict()
    const id = randomUUID()
    const run: Run = {
      id, owner, state: 'running', revision: 0, pending: 0, completedQueries: 0, totalQueries: 0,
      maxSources: input.maxSources, sources: new Map(), errors: [], controller: new AbortController(),
      listeners: new Set(), presentation: { state: 'none' },
      timer: setTimeout(() => this.finish(run, 'timed_out'), input.deadlineMs)
    }
    run.timer.unref?.()
    this.runs.set(id, run)
    this.add(run, input.queries, input.urls)
    if (input.presentation === 'live') {
      try {
        if (!this.deps.openLive) throw new Error('Live browser is unavailable')
        const url = input.urls[0] ?? `https://www.google.com/search?q=${encodeURIComponent(input.queries[0].query)}`
        run.presentation = { state: 'opened', tabId: this.deps.openLive(url) }
      } catch (error) {
        run.presentation = { state: 'failed', error: message(error) }
      }
      this.changed(run)
    }
    return this.snapshot(run)
  }

  extend(id: string, queries: SearchRequest[], urls: string[], context: ToolContext): ResearchSnapshot {
    const run = this.owned(id, context)
    if (run.state !== 'running') throw new Error('Only a running research run can be extended')
    if (run.owner.turnId !== this.deps.owner(context).turnId) throw new Error('Research belongs to a different turn')
    this.validate(queries, urls)
    if (run.totalQueries + queries.length > 12) throw new Error('At most twelve queries per run')
    this.add(run, queries, urls)
    return this.snapshot(run)
  }

  cancel(id: string, context: ToolContext): ResearchSnapshot {
    const run = this.owned(id, context)
    this.finish(run, 'cancelled')
    return this.snapshot(run)
  }

  read(id: string, context: ToolContext, after = 0): ResearchSnapshot {
    return this.snapshot(this.owned(id, context), after)
  }

  async source(id: string, sourceId: string, context: ToolContext, offset: number, maxChars: number, query?: string): Promise<unknown> {
    const run = this.owned(id, context)
    const source = [...run.sources.values()].find((item) => item.id === sourceId)
    if (!source || source.state !== 'ready') throw new Error('Source is not ready or does not belong to this run')
    const text = await this.deps.read(id, sourceId)
    this.owned(id, context)
    const start = query ? text.toLowerCase().indexOf(query.toLowerCase(), offset) : offset
    if (start < 0) return { source, found: false }
    return {
      source, offset: start, text: text.slice(start, start + maxChars),
      nextOffset: start + maxChars < text.length ? start + maxChars : null,
      evidence: 'retrieved_document', representation: 'static_text', untrusted: true
    }
  }

  async wait(id: string, context: ToolContext, after: number, timeoutMs: number): Promise<ResearchSnapshot> {
    const run = this.owned(id, context)
    if (run.revision <= after && run.state === 'running') {
      await new Promise<void>((resolve, reject) => {
        const complete = () => { cleanup(); resolve() }
        const abort = () => { cleanup(); reject(context.signal.reason) }
        const timer = setTimeout(complete, timeoutMs)
        const cleanup = () => {
          clearTimeout(timer)
          run.listeners.delete(complete)
          context.signal.removeEventListener('abort', abort)
        }
        run.listeners.add(complete)
        context.signal.addEventListener('abort', abort, { once: true })
        if (context.signal.aborted) abort()
      })
    }
    return this.read(id, context, after)
  }

  cancelPane(paneId: string, threadId?: string | null, turnId?: string | null): void {
    if (threadId && turnId) this.stoppedTurns.set(paneId, `${threadId}:${turnId}`)
    for (const run of this.runs.values()) if (run.owner.paneId === paneId) this.finish(run, 'cancelled')
  }

  reconcile(paneId: string, threadId: string | null, turnId: string | null): void {
    if (this.stoppedTurns.get(paneId) !== `${threadId}:${turnId}`) this.stoppedTurns.delete(paneId)
    for (const run of this.runs.values()) {
      if (run.owner.paneId === paneId && (run.owner.threadId !== threadId || run.owner.turnId !== turnId)) this.finish(run, 'cancelled')
    }
  }

  dispose(): void {
    this.disposed = true
    for (const run of this.runs.values()) this.finish(run, 'cancelled')
  }

  private validate(queries: SearchRequest[], urls: string[]): void {
    if (!queries.length && !urls.length) throw new Error('Supply queries or source URLs')
    if (queries.length > 6 || urls.length > 20) throw new Error('At most six queries and twenty URLs per call')
    for (const request of queries) if (!request.query.trim()) throw new Error('Search queries cannot be blank')
    for (const url of urls) publicUrl(url)
  }

  private add(run: Run, queries: SearchRequest[], urls: string[]): void {
    run.totalQueries += queries.length
    for (const url of urls) this.discover(run, { url, title: url, snippet: '', provider: undefined })
    for (const query of queries) this.track(run, async () => {
      try {
        await this.router.search(query, run.controller.signal, (update) => {
          if (run.state !== 'running') return
          if ('error' in update) {
            run.errors.push({ query: query.query.slice(0, 200), provider: update.error.provider, message: update.error.message.slice(0, 300) })
            this.changed(run)
          } else {
            for (const item of update.output.results.slice(0, query.count)) this.discover(run, item)
          }
        }, run.owner.paneId)
      } catch (error) {
        if (run.state === 'running' && !run.errors.some((item) => item.query === query.query.slice(0, 200))) {
          run.errors.push({ query: query.query.slice(0, 200), message: message(error) })
        }
      } finally { run.completedQueries += 1 }
    })
    this.changed(run)
  }

  private discover(run: Run, result: Omit<SearchResult, 'provider'> & { provider?: string }): void {
    if (run.state !== 'running') return
    try { publicUrl(result.url) } catch { return }
    if (result.url.length > 2048) return
    const key = canonicalUrl(result.url)
    const existing = run.sources.get(key)
    if (existing) {
      if (result.provider && !existing.discoveredBy.includes(result.provider)) {
        existing.discoveredBy.push(result.provider)
        existing.revision = this.changed(run)
      }
      return
    }
    if (run.sources.size >= run.maxSources) return
    const source: ResearchSource = {
      id: randomUUID(), url: result.url, title: result.title.slice(0, 180), snippet: result.snippet.slice(0, 240),
      discoveredBy: result.provider ? [result.provider] : [], state: 'queued', revision: this.changed(run)
    }
    run.sources.set(key, source)
    this.track(run, async () => {
      source.state = 'reading'
      source.revision = this.changed(run)
      try {
        const document = await this.deps.collect(source.url, run.id, source.id, run.controller.signal)
        if (run.state === 'running') this.collected(run, source, document)
      } catch (error) {
        if (run.state === 'running') {
          source.state = 'failed'; source.error = message(error); source.revision = this.changed(run)
        }
      }
    })
  }

  private collected(run: Run, source: ResearchSource, document: SourceDocument): void {
    Object.assign(source, {
      state: 'ready', title: document.title.slice(0, 180) || source.title, url: document.url,
      contentType: document.contentType, sha256: document.sha256, chars: document.text.length,
      incomplete: document.incomplete, retrievedAt: new Date().toISOString(), revision: this.changed(run)
    })
  }

  private track(run: Run, operation: () => Promise<void>): void {
    run.pending += 1
    void Promise.resolve().then(() => {
      if (run.state === 'running') return operation()
    }).catch((error: unknown) => {
      if (run.state === 'running') run.errors.push({ query: '', message: message(error) })
    }).finally(() => {
      run.pending -= 1
      if (run.pending === 0 && run.state === 'running') this.finish(run, 'completed')
      else this.changed(run)
    })
  }

  private finish(run: Run, state: ResearchState): void {
    if (run.state !== 'running') return
    run.state = state
    clearTimeout(run.timer)
    if (state !== 'completed') {
      run.controller.abort(new Error(`Research ${state}`))
      for (const source of run.sources.values()) if (source.state === 'queued' || source.state === 'reading') {
        source.state = 'failed'; source.error = `Research ${state}`; source.revision = ++run.revision
      }
    }
    this.changed(run)
  }

  private owned(id: string, context: ToolContext): Run {
    const owner = this.deps.owner(context)
    const run = this.runs.get(id)
    if (!run || run.owner.paneId !== owner.paneId || run.owner.threadId !== owner.threadId || run.owner.workspace !== owner.workspace) {
      throw new Error('Research run is unavailable in this pane, thread, or workspace')
    }
    return run
  }

  private changed(run: Run): number {
    run.revision += 1
    for (const listener of [...run.listeners]) listener()
    return run.revision
  }

  private snapshot(run: Run, after = 0): ResearchSnapshot {
    const candidates = [...run.sources.values()].filter((source) => source.revision > after).sort((a, b) => a.revision - b.revision)
    const snapshot: ResearchSnapshot = {
      runId: run.id, state: run.state, cursor: run.revision, pending: run.pending,
      completedQueries: run.completedQueries, totalQueries: run.totalQueries, sourceCount: run.sources.size,
      omittedSources: 0, omittedErrors: Math.max(0, run.errors.length - 12),
      sources: [], errors: run.errors.slice(-12), presentation: run.presentation
    }
    for (const source of candidates) {
      if (JSON.stringify(snapshot).length + JSON.stringify(source).length > 16_000) break
      snapshot.sources.push({ ...source, discoveredBy: [...source.discoveredBy] })
    }
    snapshot.omittedSources = candidates.length - snapshot.sources.length
    if (snapshot.omittedSources) snapshot.cursor = snapshot.sources.at(-1)?.revision ?? after
    return snapshot
  }

  private evict(): void {
    while (this.runs.size >= 32) {
      const oldest = [...this.runs.values()].find((run) => run.state !== 'running' && run.pending === 0)
      if (!oldest) throw new Error('Research retention is full; wait for cancelled work to settle')
      this.runs.delete(oldest.id)
      void this.deps.remove(oldest.id).catch((error: unknown) => console.warn('[research] evidence cleanup:', message(error)))
    }
  }
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300)
}
