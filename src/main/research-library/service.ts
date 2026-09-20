import type { LibraryPaper, LibrarySettings, LibrarySnapshot } from '../../shared/research-library.js'
import { discoverPapers, paperId } from './provider.js'
import { LibraryStore, MAX_DISMISSED, MAX_PAPERS, validateSettings, type LibraryState } from './store.js'
import { abortable } from '../tools/search/request-budget.js'

type Discovery = (topic: string, since: string, now: string, signal: AbortSignal) => Promise<LibraryPaper[]>
const DAY = 86_400_000

export class ResearchLibrary {
  private state: LibraryState | null = null
  private loading: Promise<LibraryState> | null = null
  private writes: Promise<unknown> = Promise.resolve()
  private pending: Promise<LibrarySnapshot> | null = null
  private controller: AbortController | null = null
  private disposed = false

  constructor(
    private readonly store: LibraryStore,
    private readonly discover: Discovery,
    private readonly now: () => number = Date.now
  ) {}

  static create(path: string, fetchPublic: typeof fetch): ResearchLibrary {
    return new ResearchLibrary(new LibraryStore(path), (topic, since, now, signal) =>
      discoverPapers(fetchPublic, topic, since, now, signal))
  }

  private async load(): Promise<LibraryState> {
    if (this.disposed) throw new Error('Research library is shutting down')
    if (this.state) return this.state
    this.loading ??= this.store.load().then((state) => { this.state = state; return state })
    return this.loading
  }

  private mutate(change: (state: LibraryState) => LibraryState): Promise<void> {
    const work = this.writes.then(async () => {
      const next = change(structuredClone(await this.load()))
      await this.store.save(next)
      this.state = next
    })
    this.writes = work.catch(() => {})
    return work
  }

  private visible(state: LibraryState): LibraryPaper[] {
    const since = this.now() - state.settings.lookbackDays * DAY
    const topics = new Set(state.settings.topics)
    const dismissed = new Set(state.dismissed)
    return state.papers.filter((paper) => !dismissed.has(paper.id) &&
      Date.parse(paper.publishedAt) >= since && paper.topics.some((topic) => topics.has(topic)))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id))
  }

  async snapshot(): Promise<LibrarySnapshot> {
    await this.writes
    const state = await this.load()
    const papers = this.visible(state)
    return structuredClone({
      settings: state.settings, refreshing: Boolean(this.pending), lastRefresh: state.lastRefresh,
      papers, total: papers.length, dismissed: state.dismissed.length
    })
  }

  async configure(input: LibrarySettings): Promise<LibrarySnapshot> {
    const settings = validateSettings(input)
    await this.mutate((state) => {
      if (this.pending) throw new Error('Stop the refresh before changing topics or settings')
      if (settings.lookbackDays !== state.settings.lookbackDays ||
        JSON.stringify(settings.topics) !== JSON.stringify(state.settings.topics)) state.lastRefresh = null
      state.settings = settings
      const topics = new Set(settings.topics)
      state.papers = state.papers.map((paper) => ({ ...paper, topics: paper.topics.filter((topic) => topics.has(topic)) }))
        .filter((paper) => paper.topics.length > 0)
      return state
    })
    return this.snapshot()
  }

  async dismiss(id: string): Promise<LibrarySnapshot> {
    if (paperId(id) !== id) throw new Error('Invalid paper id')
    await this.mutate((state) => {
      if (!state.papers.some((paper) => paper.id === id)) throw new Error('Paper is not in the library')
      if (!state.dismissed.includes(id)) {
        if (state.dismissed.length >= MAX_DISMISSED) throw new Error('Dismissal limit reached; restore dismissed papers first')
        state.dismissed.push(id)
      }
      return state
    })
    return this.snapshot()
  }

  async restore(): Promise<LibrarySnapshot> {
    await this.mutate((state) => ({ ...state, dismissed: [] }))
    return this.snapshot()
  }

  refresh(): Promise<LibrarySnapshot> {
    if (this.pending) return this.pending
    this.controller = new AbortController()
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(60_000)])
    this.pending = this.performRefresh(signal).finally(() => {
      this.pending = null
      this.controller = null
    }).then(() => this.snapshot())
    return this.pending
  }

  cancel(): void { this.controller?.abort(new Error('Refresh cancelled')) }
  dispose(): void { this.cancel(); this.disposed = true }

  private async performRefresh(signal: AbortSignal): Promise<void> {
    await this.writes
    const state = await this.load()
    const settings = structuredClone(state.settings)
    const startedAt = new Date(this.now()).toISOString()
    const since = new Date(this.now() - settings.lookbackDays * DAY).toISOString().slice(0, 10)
    const incoming: LibraryPaper[] = []
    const errors: Array<{ topic: string; message: string }> = []
    let completed = 0
    // At most two public requests at a time and five per manual refresh; no retries.
    for (let index = 0; index < settings.topics.length && !signal.aborted; index += 2) {
      const topics = settings.topics.slice(index, index + 2)
      const results = await Promise.allSettled(topics.map((topic) => abortable(this.discover(topic, since, startedAt, signal), signal)))
      results.forEach((result, offset) => {
        if (result.status === 'fulfilled') { incoming.push(...result.value); completed++ }
        else errors.push({ topic: topics[offset]!, message: String(result.reason?.message ?? result.reason).slice(0, 300) })
      })
    }
    if (this.disposed) return
    await this.mutate((current) => {
      let added = 0
      if (!signal.aborted) {
        const papers = new Map(current.papers.map((paper) => [paper.id, paper]))
        for (const paper of incoming) {
          const previous = papers.get(paper.id)
          if (!previous) added++
          papers.set(paper.id, { ...paper, topics: [...new Set([...(previous?.topics ?? []), ...paper.topics])] })
        }
        current.papers = [...papers.values()]
          .filter((paper) => Date.parse(paper.publishedAt) >= Date.parse(since))
          .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id))
          .slice(0, MAX_PAPERS)
      }
      current.lastRefresh = {
        startedAt, finishedAt: new Date(this.now()).toISOString(),
        state: signal.aborted ? signal.reason?.name === 'TimeoutError' ? 'timed_out' : 'cancelled'
          : errors.length ? completed ? 'partial' : 'failed' : 'completed',
        received: signal.aborted ? 0 : new Set(incoming.map((paper) => paper.id)).size,
        added, errors
      }
      return current
    })
  }

  async status() {
    const snapshot = await this.snapshot()
    return { ...this.provenance(), settings: snapshot.settings, total: snapshot.total,
      refreshing: snapshot.refreshing, lastRefresh: snapshot.lastRefresh }
  }

  async search(query: string, limit = 5) {
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 300) throw new Error('Query must be 2–300 characters')
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('Limit must be 1–10')
    const state = await this.load()
    if (!state.settings.enabled) throw new Error('Research library retrieval is disabled in Tools → Research library')
    const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter((term) => term.length > 1)
    if (!terms.length) throw new Error('Query must contain searchable words')
    const ranked = this.visible(state).map((paper) => {
      const title = new Set(paper.title.toLowerCase().match(/[\p{L}\p{N}]+/gu))
      const body = new Set(paper.abstract.toLowerCase().match(/[\p{L}\p{N}]+/gu))
      const matches = terms.filter((term) => title.has(term) || body.has(term)).length
      return { paper, matches, score: terms.reduce((score, term) => score + (title.has(term) ? 3 : body.has(term) ? 1 : 0), 0) }
    }).filter((row) => row.matches >= Math.min(2, terms.length))
      .sort((a, b) => b.score - a.score || b.paper.publishedAt.localeCompare(a.paper.publishedAt))
    return {
      ...this.provenance(), query, matched: ranked.length, lastRefresh: state.lastRefresh,
      results: ranked.slice(0, limit).map(({ paper, matches }) => ({
        id: paper.id, title: paper.title, url: paper.url, publishedAt: paper.publishedAt,
        retrievedAt: paper.retrievedAt, stale: this.now() - Date.parse(paper.retrievedAt) > 7 * DAY,
        matchedTerms: matches, excerpt: paper.abstract.slice(0, 400)
      }))
    }
  }

  async read(id: string) {
    const state = await this.load()
    if (!state.settings.enabled) throw new Error('Research library retrieval is disabled in Tools → Research library')
    const paper = this.visible(state).find((paper) => paper.id === id)
    if (!paper) throw new Error('Paper is not in the active library; search for a current id')
    return { ...this.provenance(), ...structuredClone(paper), stale: this.now() - Date.parse(paper.retrievedAt) > 7 * DAY }
  }

  private provenance() {
    return { scope: 'app-shared-public', source: 'alphaXiv', evidence: 'paper_metadata_and_abstract',
      trust: 'untrusted', note: 'Discovery evidence, not verified findings. Read the linked paper before relying on its methods or claims.' }
  }
}
