import { useEffect, useState } from 'react'
import type { ResearchActivity, ResearchActivityEvent } from '../../shared/web-research.js'

/** Fold one main-process event into a pane's run list. Runs from other panes are ignored. */
export function applyResearchEvent(runs: ResearchActivity[], event: ResearchActivityEvent, paneId: string): ResearchActivity[] {
  if (event.type === 'evicted') {
    return runs.some((run) => run.runId === event.runId) ? runs.filter((run) => run.runId !== event.runId) : runs
  }
  if (event.run.paneId !== paneId) return runs
  const index = runs.findIndex((run) => run.runId === event.run.runId)
  const next = index < 0 ? [...runs, event.run] : runs.map((run, at) => (at === index ? event.run : run))
  return next.sort((a, b) => a.startedAt - b.startedAt)
}

/** A mount backfill is older than any event that arrived while it was in flight. */
export function mergeBackfill(fetched: ResearchActivity[], live: ResearchActivity[]): ResearchActivity[] {
  const byId = new Map(fetched.map((run) => [run.runId, run]))
  for (const run of live) byId.set(run.runId, run)
  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt)
}

/** Running work is always shown; finished runs stay until the conversation moves past their turn. */
export function currentResearchRuns(runs: ResearchActivity[], turnIds: Array<string | null>): ResearchActivity[] {
  const keep = new Set(turnIds.filter((id): id is string => id !== null))
  return runs.filter((run) => run.state === 'running' || (run.turnId !== null && keep.has(run.turnId)))
}

export function useResearchActivity(paneId: string): ResearchActivity[] {
  const [runs, setRuns] = useState<ResearchActivity[]>([])
  useEffect(() => {
    let active = true
    setRuns([])
    const unsubscribe = window.closedai.research.onEvent((event) => {
      if (active) setRuns((previous) => applyResearchEvent(previous, event, paneId))
    })
    void window.closedai.research.activity(paneId)
      .then((fetched) => { if (active) setRuns((live) => mergeBackfill(fetched, live)) })
      .catch(() => {})
    return () => { active = false; unsubscribe() }
  }, [paneId])
  return runs
}

export function describeRuns(runs: ResearchActivity[]): string {
  const running = runs.filter((run) => run.state === 'running')
  const sources = runs.reduce((total, run) => total + run.sources.length, 0)
  const ready = runs.reduce((total, run) => total + run.counts.ready, 0)
  if (running.length) {
    const searching = running.reduce((total, run) => total + (run.queries.length - run.completedQueries), 0)
    const parts = [searching ? `${searching} searching` : '', sources ? `${ready} of ${sources} sources ready` : '']
    return `Research · ${parts.filter(Boolean).join(' · ') || 'starting'}`
  }
  const failed = runs.some((run) => run.state !== 'completed')
  return `Research ${failed ? 'stopped' : 'finished'} · ${ready} ${ready === 1 ? 'source' : 'sources'} ready`
}

export function sourceHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}
