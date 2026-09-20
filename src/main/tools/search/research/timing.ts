export type ResearchTimingEvent = {
  event: 'started' | 'read_started' | 'first_source' | 'read_finished' | 'finished'
  runId: string
  elapsedMs: number
  sourceId?: string
  durationMs?: number
  admissionWaitMs?: number
  state?: string
}

/** Monotonic, bounded, content-free timing; diagnostics must never break research. */
export class ResearchTiming {
  private readonly started: number
  private first = true
  private readonly discovered = new Map<string, number>()
  private readonly reading = new Map<string, number>()

  constructor(private readonly runId: string, private readonly emit: (event: ResearchTimingEvent) => void,
    private readonly now: () => number = () => performance.now()) {
    this.started = now()
    this.note('started')
  }

  discover(sourceId: string): void { this.discovered.set(sourceId, this.now()) }

  begin(sourceId: string): void {
    const now = this.now()
    this.reading.set(sourceId, now)
    this.note('read_started', { sourceId, admissionWaitMs: Math.max(0, now - (this.discovered.get(sourceId) ?? now)) })
  }

  end(sourceId: string, state: string): void {
    const start = this.reading.get(sourceId)
    this.reading.delete(sourceId)
    this.discovered.delete(sourceId)
    if (state === 'ready' && this.first) { this.first = false; this.note('first_source', { sourceId }) }
    this.note('read_finished', { sourceId, state, durationMs: start === undefined ? undefined : Math.max(0, this.now() - start) })
  }

  finish(state: string): void { this.note('finished', { state }) }

  private note(event: ResearchTimingEvent['event'], detail: Partial<ResearchTimingEvent> = {}): void {
    try { this.emit({ ...detail, event, runId: this.runId, elapsedMs: Math.max(0, this.now() - this.started) }) } catch { /* Best-effort diagnostics. */ }
  }
}
