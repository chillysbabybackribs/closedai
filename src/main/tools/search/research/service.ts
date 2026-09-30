import { randomUUID } from 'node:crypto'
import type { ResearchSnapshot, ResearchSource, ResearchState } from '../../../../shared/web-research.js'
import type { ToolContext } from '../../tool.js'
import { canonicalUrl, SearchRouter } from '../router.js'
import type { ProvidedContent, SearchRequest, SearchResult } from '../types.js'
import { publicUrl, SourceNeedsRendering, type SourceDocument, type SourceReader } from './source-reader.js'
import { isResearchSourceUrl, SourcePresentation, type OpenSearchTab } from '../presentation.js'
import { mergeDates } from './source-metadata.js'
import { MAX_CANDIDATES, prefersDomain, SourceAdmission } from './source-admission.js'
import { ResearchTiming, type ResearchTimingEvent } from './timing.js'
import { validateCoverage, type SourceCoverage } from './coverage.js'
import type { PdfInspectionRequest, PdfPageEvidence } from '../../../../shared/pdf-evidence.js'
import { validatePdfInspection } from './pdf/inspector.js'

export type ResearchOwner = { paneId: string; threadId: string; turnId: string | null; workspace: string }
export type ProvidedPage = { url: string; title: string; text: string; truncated: boolean }
export type ResearchDependencies = {
  owner(context: ToolContext): ResearchOwner
  collect: SourceReader
  /** Hidden Chromium read for pages whose static body is a JavaScript shell; absent means no workers. */
  render?: SourceReader
  /** Keeps page text a provider returned with discovery; absent means provider text is ignored and pages are fetched. */
  retain?: (runId: string, sourceId: string, page: ProvidedPage, coverage?: SourceCoverage) => Promise<SourceDocument>
  /** Extract a selected URL with Exa, retaining it under the supplied staging id. */
  extract?: SourceReader
  replace?: (runId: string, sourceId: string, stagedId: string) => Promise<void>
  discard?: (runId: string, sourceId: string) => Promise<void>
  read(runId: string, sourceId: string): Promise<string>
  remove(runId: string): Promise<void>
  inspectPdf?: (runId: string, sourceId: string, documentSha256: string, request: PdfInspectionRequest, signal: AbortSignal) => Promise<PdfPageEvidence>
  /** Opens a retained, user-owned tab once. Never follows subsequent results automatically. */
  openLive?: OpenSearchTab
  trace?: (owner: ResearchOwner, event: ResearchTimingEvent) => void
  now?: () => number
}
export type ResearchInput = {
  queries: SearchRequest[]; urls: string[]; maxSources: number; deadlineMs: number; presentation: 'live' | 'background'
  reserveSources?: number
  coverage?: SourceCoverage
}
type Run = {
  id: string; owner: ResearchOwner; state: ResearchState; revision: number; pending: number
  completedQueries: number; totalQueries: number; maxSources: number
  sources: Map<string, ResearchSource>; errors: ResearchSnapshot['errors']; controller: AbortController
  listeners: Set<() => void>; timer: ReturnType<typeof setTimeout>
  presentation: SourcePresentation
  admission: SourceAdmission; preferredDomains: Set<string>; omittedCandidates: number
  timing: ResearchTiming
  coverage: SourceCoverage
  expansions: Map<string, { controller: AbortController; turnId: string; committing?: boolean }>
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
    validateCoverage(input.coverage ?? {})
    if ([...this.runs.values()].filter((run) => run.state === 'running').length >= 8) {
      throw new Error('Eight research runs are already active; extend an existing run or wait for it')
    }
    this.evict()
    const id = randomUUID()
    const run: Run = {
      id, owner, state: 'running', revision: 0, pending: 0, completedQueries: 0, totalQueries: 0,
      maxSources: input.maxSources, sources: new Map(), errors: [], controller: new AbortController(),
      listeners: new Set(), presentation: new SourcePresentation(this.deps.openLive, context, input.presentation),
      admission: new SourceAdmission(input.maxSources, input.reserveSources), preferredDomains: new Set(), omittedCandidates: 0,
      timing: new ResearchTiming(id, (event) => this.deps.trace?.(owner, event), this.deps.now),
      coverage: input.coverage ?? {}, expansions: new Map(),
      timer: setTimeout(() => this.finish(run, 'timed_out'), input.deadlineMs)
    }
    run.timer.unref?.()
    this.runs.set(id, run)
    this.add(run, input.queries, input.urls)
    return this.snapshot(run)
  }

  extend(id: string, queries: SearchRequest[], urls: string[], context: ToolContext): ResearchSnapshot {
    const run = this.owned(id, context)
    if (run.state !== 'running') throw new Error(`Research run is ${run.state}; start a new run for follow-up queries or URLs`)
    if (run.owner.turnId !== this.deps.owner(context).turnId) throw new Error('Research belongs to a different turn')
    this.validate(queries, urls)
    if (run.totalQueries + queries.length > 12) throw new Error('At most twelve queries per run')
    this.add(run, queries, urls)
    return this.snapshot(run)
  }

  cancel(id: string, context: ToolContext): ResearchSnapshot {
    const run = this.owned(id, context)
    for (const { controller } of run.expansions.values()) controller.abort(new Error('Expansion cancelled'))
    this.finish(run, 'cancelled')
    return this.snapshot(run)
  }

  read(id: string, context: ToolContext, after = 0): ResearchSnapshot {
    return this.snapshot(this.owned(id, context), after)
  }

  async expand(id: string, sourceId: string, context: ToolContext, coverage: SourceCoverage,
    method: 'auto' | 'direct' | 'exa' = 'auto'): Promise<unknown> {
    const run = this.owned(id, context)
    const owner = this.deps.owner(context)
    if (this.disposed || !owner.turnId || this.stoppedTurns.get(owner.paneId) === `${owner.threadId}:${owner.turnId}`) {
      throw new Error('Expand sources during an active, unstopped turn')
    }
    validateCoverage(coverage)
    const source = [...run.sources.values()].find((item) => item.id === sourceId)
    if (!source || !['ready', 'failed', 'deferred'].includes(source.state)) throw new Error('Source is unavailable or still being collected')
    if (run.expansions.has(sourceId)) throw new Error('This source is already expanding or has a PDF inspection in progress')
    if (!this.deps.replace || !this.deps.discard) throw new Error('Source expansion storage is unavailable')
    const provider = method === 'exa' || (method === 'auto' && source.contentProvider === 'exa')
    const reader = provider ? this.deps.extract : this.deps.collect
    if (!reader) throw new Error('Exa source extraction is unavailable')
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, context.signal, AbortSignal.timeout(45_000)])
    const stagedId = randomUUID()
    run.expansions.set(sourceId, { controller, turnId: owner.turnId })
    source.expanding = true
    delete source.expansionError
    source.revision = this.changed(run)
    try {
      const url = source.requestedUrl ?? source.url
      let document: SourceDocument
      try { document = await reader(url, id, stagedId, signal, coverage) }
      catch (error) {
        if (provider || !(error instanceof SourceNeedsRendering) || !this.deps.render) throw error
        document = await this.deps.render(url, id, stagedId, signal, coverage)
      }
      if (!provider && document.sparse && this.deps.render) {
        document = await this.deps.render(source.requestedUrl ?? source.url, id, stagedId, signal, coverage)
      }
      signal.throwIfAborted()
      this.owned(id, context)
      if (this.deps.owner(context).turnId !== owner.turnId) throw new Error('The expansion turn has ended')
      if (source.state === 'ready' && document.text.length < (source.chars ?? 0)) {
        source.expansionError = 'Expansion returned less text; the previous document was preserved'
        return { changed: false, source: { ...source, expanding: false }, untrusted: true }
      }
      run.expansions.get(sourceId)!.committing = true
      await this.deps.replace(id, sourceId, stagedId)
      this.collected(run, source, document)
      delete source.error
      if (provider) source.contentProvider = 'exa'
      else delete source.contentProvider
      return { changed: true, source: { ...source, expanding: false }, untrusted: true }
    } catch (error) {
      source.expansionError = message(error)
      throw error
    } finally {
      source.expanding = false
      source.revision = this.changed(run)
      try { await this.deps.discard(id, stagedId) }
      finally { run.expansions.delete(sourceId); this.changed(run); this.admit(run) }
    }
  }

  /** Uses the same operation leases as expansion: pin files, serialize revision access, abort on turn end. */
  async inspectPdf(id: string, sourceId: string, context: ToolContext, request: PdfInspectionRequest): Promise<PdfPageEvidence> {
    validatePdfInspection(request)
    const run = this.owned(id, context)
    const owner = this.deps.owner(context)
    if (this.disposed || !owner.turnId || this.stoppedTurns.get(owner.paneId) === `${owner.threadId}:${owner.turnId}`) {
      throw new Error('Inspect PDFs during an active, unstopped turn')
    }
    const source = [...run.sources.values()].find((item) => item.id === sourceId)
    const hash = source?.pdf?.documentSha256
    if (source?.state !== 'ready' || source.representation !== 'pdf_text' || !hash) {
      throw new Error('No retained PDF bytes for this source; use search.run expand with method direct first')
    }
    if (request.page > source.pdf!.totalPages) throw new Error(`Page must be between 1 and ${source.pdf!.totalPages}`)
    if (!this.deps.inspectPdf) throw new Error('PDF inspection is unavailable')
    if (run.expansions.has(sourceId)) throw new Error('This source is already expanding or has a PDF inspection in progress')
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, context.signal, AbortSignal.timeout(60_000)])
    run.expansions.set(sourceId, { controller, turnId: owner.turnId })
    this.changed(run)
    try {
      const result = await this.deps.inspectPdf(id, sourceId, hash, request, signal)
      signal.throwIfAborted()
      this.owned(id, context)
      if (this.deps.owner(context).turnId !== owner.turnId || result.documentSha256 !== hash) {
        throw new Error('PDF inspection no longer belongs to this turn or source revision')
      }
      return result
    } finally { run.expansions.delete(sourceId); this.changed(run) }
  }

  async source(id: string, sourceId: string, context: ToolContext, offset: number, maxChars: number, query?: string): Promise<unknown> {
    const run = this.owned(id, context)
    const source = [...run.sources.values()].find((item) => item.id === sourceId)
    if (!source || source.state !== 'ready') throw new Error('Source is not ready or does not belong to this run')
    const hash = source.sha256
    const replacing = () => run.expansions.get(sourceId)?.committing === true
    if (replacing()) throw new Error('Source text is being replaced; retry from a fresh offset')
    const text = await this.deps.read(id, sourceId)
    this.owned(id, context)
    if (replacing() || source.sha256 !== hash) throw new Error('Source text changed during this read; retry from a fresh offset')
    const start = query ? text.toLowerCase().indexOf(query.toLowerCase(), offset) : offset
    if (start < 0) return { source, found: false }
    return {
      source, offset: start, text: text.slice(start, start + maxChars),
      nextOffset: start + maxChars < text.length ? start + maxChars : null,
      evidence: 'retrieved_document', representation: source.representation ?? 'static_text', untrusted: true
    }
  }

  /** With a cursor, resolves on the next revision; without one, waits for the run to settle and returns every retained source. */
  async wait(id: string, context: ToolContext, after: number | undefined, timeoutMs: number): Promise<ResearchSnapshot> {
    const run = this.owned(id, context)
    const ready = () => (run.state !== 'running' && run.expansions.size === 0) || (after !== undefined && run.revision > after)
    if (!ready()) {
      await new Promise<void>((resolve, reject) => {
        const complete = () => { cleanup(); resolve() }
        const changed = () => { if (ready()) complete() }
        const abort = () => { cleanup(); reject(context.signal.reason) }
        const timer = setTimeout(complete, timeoutMs)
        const cleanup = () => {
          clearTimeout(timer)
          run.listeners.delete(changed)
          context.signal.removeEventListener('abort', abort)
        }
        run.listeners.add(changed)
        context.signal.addEventListener('abort', abort, { once: true })
        if (context.signal.aborted) abort()
      })
    }
    return this.read(id, context, after ?? 0)
  }

  cancelPane(paneId: string, threadId?: string | null, turnId?: string | null): void {
    if (threadId && turnId) this.stoppedTurns.set(paneId, `${threadId}:${turnId}`)
    for (const run of this.runs.values()) if (run.owner.paneId === paneId) this.finish(run, 'cancelled')
  }

  reconcile(paneId: string, threadId: string | null, turnId: string | null): void {
    if (this.stoppedTurns.get(paneId) !== `${threadId}:${turnId}`) this.stoppedTurns.delete(paneId)
    for (const run of this.runs.values()) {
      if (run.owner.paneId === paneId) for (const expansion of run.expansions.values()) {
        if (run.owner.threadId !== threadId || expansion.turnId !== turnId) expansion.controller.abort(new Error('The expansion turn has ended'))
      }
      if (run.owner.paneId === paneId && (run.owner.threadId !== threadId || run.owner.turnId !== turnId)) this.finish(run, 'cancelled', false)
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
    for (const url of urls) {
      publicUrl(url)
      if (!isResearchSourceUrl(url)) throw new Error('Supply actual source URLs; search-engine results pages cannot be gathered as sources')
    }
  }

  private add(run: Run, queries: SearchRequest[], urls: string[]): void {
    run.totalQueries += queries.length
    for (const query of queries) for (const domain of query.preferredDomains ?? []) run.preferredDomains.add(domain)
    for (const source of run.sources.values()) if (source.state === 'deferred' && source.selection === 'discovery' && prefersDomain(source.url, run.preferredDomains)) {
      source.selection = 'preferred_domain'
      source.revision = this.changed(run)
    }
    for (const url of urls) this.discover(run, { url, title: url, snippet: '', provider: undefined }, true)
    this.admit(run)
    for (const query of queries) this.track(run, async () => {
      try {
        await this.router.search({ ...query, includeAnswer: false, sourceText: true, maxTextChars: run.coverage.maxTextChars }, run.controller.signal, (update) => {
          if (run.state !== 'running') return
          if ('error' in update) {
            run.errors.push({ query: query.query.slice(0, 200), provider: update.error.provider, message: update.error.message.slice(0, 300) })
            this.changed(run)
          } else {
            for (const item of update.output.results.slice(0, query.count)) this.discover(run, item)
            this.admit(run)
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

  private discover(run: Run, result: Omit<SearchResult, 'provider'> & { provider?: string }, requested = false): void {
    if (run.state !== 'running') return
    if (!isResearchSourceUrl(result.url)) return
    try { publicUrl(result.url) } catch { return }
    if (result.url.length > 2048) return
    const key = canonicalUrl(result.url)
    const existing = run.sources.get(key)
    if (existing) {
      if (requested) existing.selection = 'requested'
      existing.dates = mergeDates(existing.dates, result.dates)
      if (result.discovery && !existing.discovery?.some((entry) => JSON.stringify(entry) === JSON.stringify(result.discovery))) {
        existing.discovery = [...(existing.discovery ?? []), result.discovery].slice(-8)
      }
      if (result.provider && !existing.discoveredBy.includes(result.provider)) {
        existing.discoveredBy.push(result.provider)
      }
      existing.revision = this.changed(run)
      if (result.content && result.provider) this.retainProvided(run, existing, result.provider, result.content)
      return
    }
    if (run.sources.size >= MAX_CANDIDATES) {
      run.omittedCandidates += 1
      if (requested) run.errors.push({ query: '', message: 'Candidate budget is full; start another run for the requested URL' })
      this.changed(run)
      return
    }
    const source: ResearchSource = {
      id: randomUUID(), url: result.url, title: result.title.slice(0, 180), snippet: result.snippet.slice(0, 240),
      requestedUrl: result.url, dates: result.dates, discovery: result.discovery ? [result.discovery] : [],
      selection: requested ? 'requested' : prefersDomain(result.url, run.preferredDomains) ? 'preferred_domain' : 'discovery',
      discoveredBy: result.provider ? [result.provider] : [], state: 'deferred', revision: this.changed(run)
    }
    run.sources.set(key, source)
    run.timing.discover(source.id)
    if (result.content && result.provider) this.retainProvided(run, source, result.provider, result.content)
  }

  /**
   * Text a provider extracted is retained as it arrived: no fetch, no read slot, and no byte-level
   * provenance of our own, so the representation says so. Sources already queued keep their fetch.
   */
  private retainProvided(run: Run, source: ResearchSource, provider: string, content: ProvidedContent): void {
    if (!this.deps.retain || source.expanding || source.state !== 'deferred' || run.state !== 'running') return
    source.state = 'reading'
    source.revision = this.changed(run)
    run.timing.begin(source.id)
    if (run.presentation.consider(source.url)) this.changed(run)
    this.track(run, async () => {
      try {
        const document = await this.deps.retain!(run.id, source.id, { url: source.url, title: source.title, text: content.text, truncated: content.truncated }, run.coverage)
        if (run.state !== 'running') return
        this.collected(run, source, document)
        source.contentProvider = provider
      } catch (error) {
        if (run.state !== 'running') return
        // Retention failed locally; the ordinary fetch path can still read the page.
        source.state = 'deferred'; source.error = message(error); source.revision = this.changed(run)
      } finally { run.timing.end(source.id, source.state); this.admit(run) }
    })
  }

  private admit(run: Run): void {
    if (run.state !== 'running') return
    for (let source = run.admission.next(run.sources.values()); source; source = run.admission.next(run.sources.values())) {
      run.admission.begin(source)
      run.timing.begin(source.id)
      source.state = 'queued'
      source.revision = this.changed(run)
      if (run.presentation.consider(source.url)) this.changed(run)
      this.collect(run, source)
    }
  }

  private collect(run: Run, source: ResearchSource): void {
    this.track(run, async () => {
      source.state = 'reading'
      source.revision = this.changed(run)
      try {
        const document = await this.deps.collect(source.url, run.id, source.id, run.controller.signal, run.coverage)
        if (run.state !== 'running') return
        if (document.sparse && this.deps.render) await this.render(run, source, document)
        else this.collected(run, source, document)
      } catch (error) {
        if (run.state !== 'running') return
        if (error instanceof SourceNeedsRendering) await this.render(run, source, null, error)
        else { source.state = 'failed'; source.error = message(error); source.revision = this.changed(run) }
      } finally { run.timing.end(source.id, source.state); run.admission.end(); this.admit(run) }
    })
  }

  /**
   * Static reads come first because they are cheap and inert. A page that yields nothing, or
   * a script-bearing shell with almost no text, is loaded once in a hidden worker; the worker's
   * text replaces the static text. With no worker, or when it fails, the static outcome stands.
   */
  private async render(run: Run, source: ResearchSource, fallback: SourceDocument | null, cause?: Error): Promise<void> {
    if (!this.deps.render) {
      if (!fallback) { source.state = 'failed'; source.error = message(cause); source.revision = this.changed(run) }
      return
    }
    source.state = 'rendering'
    source.revision = this.changed(run)
    try {
      const document = await this.deps.render(source.url, run.id, source.id, run.controller.signal, run.coverage)
      if (run.state === 'running') this.collected(run, source, { ...document, dates: mergeDates(document.dates, fallback?.dates) })
    } catch (error) {
      if (run.state !== 'running') return
      if (fallback) { this.collected(run, source, fallback); return }
      source.state = 'failed'
      source.error = `${message(cause)}; rendered read failed: ${message(error)}`.slice(0, 300)
      source.revision = this.changed(run)
    }
  }

  private collected(run: Run, source: ResearchSource, document: SourceDocument): void {
    Object.assign(source, {
      state: 'ready', title: document.title.slice(0, 180) || source.title, url: document.url,
      contentType: document.contentType, sha256: document.sha256, chars: document.text.length,
      incomplete: document.incomplete, representation: document.representation, pdf: document.pdf,
      dates: mergeDates(document.dates, source.dates),
      retrievedAt: new Date().toISOString(), revision: this.changed(run)
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

  private finish(run: Run, state: ResearchState, cancelExpansions = true): void {
    if (cancelExpansions && state !== 'completed') for (const { controller } of run.expansions.values()) controller.abort(new Error(`Research ${state}`))
    if (run.state !== 'running') return
    run.state = state
    run.timing.finish(state)
    run.presentation.finish()
    clearTimeout(run.timer)
    if (state !== 'completed') {
      run.controller.abort(new Error(`Research ${state}`))
      for (const source of run.sources.values()) if (source.state === 'queued' || source.state === 'reading' || source.state === 'rendering') {
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
      runId: run.id, state: run.state, cursor: run.revision, pending: run.pending + run.expansions.size,
      completedQueries: run.completedQueries, totalQueries: run.totalQueries, sourceCount: run.sources.size,
      omittedSources: 0, omittedErrors: Math.max(0, run.errors.length - 12),
      readCount: run.admission.readCount, maxReads: run.maxSources, reservedReads: run.admission.reserved,
      omittedCandidates: run.omittedCandidates,
      sources: [], errors: run.errors.slice(-12), presentation: run.presentation.snapshot()
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
      const oldest = [...this.runs.values()].find((run) => run.state !== 'running' && run.pending === 0 && run.expansions.size === 0)
      if (!oldest) throw new Error('Research retention is full; wait for cancelled work to settle')
      this.runs.delete(oldest.id)
      void this.deps.remove(oldest.id).catch((error: unknown) => console.warn('[research] evidence cleanup:', message(error)))
    }
  }
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300)
}
