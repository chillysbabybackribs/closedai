// Video renders outlive a tool call: a 30-second 1080p clip takes about a minute here, longer
// than some providers wait for one call. A render is therefore a job the call starts and then
// waits on for a bounded time; later calls read or cancel it by id. One render runs at a time
// because it saturates the CPU. Jobs are in memory and end with the app.

export type VideoJobState = 'rendering' | 'completed' | 'failed' | 'cancelled'

export type VideoJobWork = (signal: AbortSignal, onFrame: (done: number, total: number) => void) => Promise<{ bytes: number }>

/** Runs after a successful render (the preview tab); its failure is reported, not fatal. */
export type VideoJobFollowUp = () => Promise<Record<string, unknown>>

export type VideoJobView = {
  jobId: string
  state: VideoJobState
  output: string
  framesDone: number
  framesTotal: number
  percent: number
  elapsedSeconds: number
  remainingSeconds?: number
  bytes?: number
  error?: string
  opened?: Record<string, unknown>
  openError?: string
}

type VideoJob = {
  id: string
  state: VideoJobState
  output: string
  framesDone: number
  framesTotal: number
  startedAt: number
  finishedAt?: number
  bytes?: number
  error?: string
  opened?: Record<string, unknown>
  openError?: string
  controller: AbortController
  settled: Promise<void>
}

const KEEP_FINISHED = 20

export class VideoJobs {
  private readonly jobs = new Map<string, VideoJob>()
  private sequence = 0

  constructor(private readonly now: () => number = Date.now) {}

  /** The render in progress, if any. */
  active(): VideoJobView | null {
    const job = [...this.jobs.values()].find((entry) => entry.state === 'rendering')
    return job ? this.view(job) : null
  }

  start(output: string, framesTotal: number, work: VideoJobWork, followUp?: VideoJobFollowUp): VideoJobView {
    const running = this.active()
    if (running) throw new Error(`Render ${running.jobId} is still running (${running.percent}%); wait for it with status or cancel it first`)
    const id = `video-${++this.sequence}`
    const controller = new AbortController()
    const job = { id, state: 'rendering', output, framesDone: 0, framesTotal, startedAt: this.now(), controller } as VideoJob
    job.settled = this.run(job, work, followUp)
    this.jobs.set(id, job)
    this.prune()
    return this.view(job)
  }

  /** Resolve when the job finishes, `waitMs` passes, or the caller is aborted, whichever is first. */
  async wait(id: string, waitMs: number, signal: AbortSignal): Promise<VideoJobView> {
    const job = this.require(id)
    if (job.state === 'rendering' && waitMs > 0) {
      let timer: NodeJS.Timeout | undefined
      let onAbort = (): void => {}
      await Promise.race([
        job.settled,
        new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs) }),
        new Promise<void>((resolve) => { onAbort = resolve; signal.addEventListener('abort', resolve, { once: true }) })
      ])
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    return this.view(job)
  }

  async cancel(id: string): Promise<VideoJobView> {
    const job = this.require(id)
    if (job.state === 'rendering') {
      job.controller.abort()
      await job.settled
    }
    return this.view(job)
  }

  dispose(): void {
    for (const job of this.jobs.values()) job.controller.abort()
  }

  private async run(job: VideoJob, work: VideoJobWork, followUp?: VideoJobFollowUp): Promise<void> {
    try {
      const result = await work(job.controller.signal, (done, total) => { job.framesDone = done; job.framesTotal = total })
      job.bytes = result.bytes
      job.state = 'completed'
    } catch (error) {
      job.state = job.controller.signal.aborted ? 'cancelled' : 'failed'
      if (job.state === 'failed') job.error = error instanceof Error ? error.message : String(error)
    }
    job.finishedAt = this.now()
    if (job.state !== 'completed' || !followUp) return
    try {
      job.opened = await followUp()
    } catch (error) {
      job.openError = error instanceof Error ? error.message : String(error)
    }
  }

  private require(id: string): VideoJob {
    const job = this.jobs.get(id)
    if (!job) {
      const known = [...this.jobs.keys()]
      throw new Error(`No video job ${id}${known.length ? `; known jobs: ${known.join(', ')}` : ''}`)
    }
    return job
  }

  private prune(): void {
    const finished = [...this.jobs.values()].filter((job) => job.state !== 'rendering')
    for (const job of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) this.jobs.delete(job.id)
  }

  private view(job: VideoJob): VideoJobView {
    const elapsed = ((job.finishedAt ?? this.now()) - job.startedAt) / 1000
    const view: VideoJobView = {
      jobId: job.id,
      state: job.state,
      output: job.output,
      framesDone: job.framesDone,
      framesTotal: job.framesTotal,
      percent: job.framesTotal ? Math.floor((job.framesDone / job.framesTotal) * 100) : 0,
      elapsedSeconds: Math.round(elapsed * 10) / 10
    }
    if (job.state === 'rendering' && job.framesDone > 0) {
      view.remainingSeconds = Math.ceil((elapsed / job.framesDone) * (job.framesTotal - job.framesDone))
    }
    if (job.bytes !== undefined) view.bytes = job.bytes
    if (job.error) view.error = job.error
    if (job.opened) view.opened = job.opened
    if (job.openError) view.openError = job.openError
    return view
  }
}
