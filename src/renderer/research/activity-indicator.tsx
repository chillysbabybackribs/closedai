import { useState } from 'react'
import { Popover } from 'radix-ui'
import { Check, CircleSlash, ExternalLink, FileText, LoaderCircle, Square, X, XCircle } from 'lucide-react'
import type { ResearchActivity, ResearchActivitySource, ResearchExcerpt } from '../../shared/web-research.js'
import { describeRuns, sourceHost } from './activity-controller.js'

type ExcerptState = { loading: boolean; error?: string; pages: ResearchExcerpt[] }

function StateIcon({ state }: { state: ResearchActivity['state'] | ResearchActivitySource['state'] }) {
  if (state === 'running' || state === 'reading' || state === 'queued') return <LoaderCircle className="research-activity-spinner" />
  if (state === 'cancelled') return <CircleSlash />
  if (state === 'failed' || state === 'timed_out') return <XCircle />
  return <Check />
}

const RUN_LABEL: Record<ResearchActivity['state'], string> = {
  running: 'Running', completed: 'Completed', cancelled: 'Stopped', timed_out: 'Timed out'
}
const SOURCE_LABEL: Record<ResearchActivitySource['state'], string> = {
  queued: 'Queued', reading: 'Reading', ready: 'Ready', failed: 'Failed'
}

function presentationLine(run: ResearchActivity): string {
  switch (run.presentation.state) {
    case 'opened': return 'Source tab open in the browser'
    case 'waiting_for_source': return 'Waiting for a source to open in the browser'
    case 'no_source': return 'No source page opened'
    case 'failed': return `Browser tab failed: ${run.presentation.error ?? 'unknown error'}`
    default: return 'Background research; no browser tab'
  }
}

export function ResearchActivityIndicator({ runs }: { runs: ResearchActivity[] }) {
  const running = runs.some((run) => run.state === 'running')
  const stopped = runs.some((run) => run.state === 'cancelled' || run.state === 'timed_out')
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="research-activity-indicator" data-ui="research.activity-jump">
          {running ? <LoaderCircle className="research-activity-spinner" /> : stopped ? <CircleSlash /> : <Check />}
          {describeRuns(runs)}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="research-activity-popover" side="top" align="end" sideOffset={10}
          collisionPadding={16} aria-label="Web research activity">
          <div className="research-activity-title">
            <span>Web research</span>
            <Popover.Close asChild>
              <button type="button" data-ui="research.activity-close" aria-label="Close web research activity"><X size={16} /></button>
            </Popover.Close>
          </div>
          {runs.map((run) => <RunDetails key={run.runId} run={run} />)}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function RunDetails({ run }: { run: ResearchActivity }) {
  const [excerpts, setExcerpts] = useState<Record<string, ExcerptState>>({})
  const load = (sourceId: string, offset: number) => {
    setExcerpts((previous) => ({ ...previous, [sourceId]: { loading: true, pages: previous[sourceId]?.pages ?? [] } }))
    void window.closedai.research.excerpt(run.runId, sourceId, offset).then((page) => {
      setExcerpts((previous) => ({ ...previous, [sourceId]: { loading: false, pages: [...(previous[sourceId]?.pages ?? []), page] } }))
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      setExcerpts((previous) => ({ ...previous, [sourceId]: { loading: false, error: message, pages: previous[sourceId]?.pages ?? [] } }))
    })
  }
  const toggle = (sourceId: string) => {
    if (excerpts[sourceId]) setExcerpts(({ [sourceId]: _dropped, ...rest }) => rest)
    else load(sourceId, 0)
  }
  const { counts } = run
  const failed = run.state === 'timed_out' || run.state === 'cancelled'
  const elapsed = Math.max(0, Math.floor(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000))
  return (
    <details open className="research-activity-run" data-failed={failed || undefined}>
      <summary data-ui="research.run" data-ui-key={run.runId}>
        <StateIcon state={run.state} />
        <span className="research-activity-name">{run.queries.join(' · ') || 'Supplied sources'}</span>
        <span className="research-activity-meta">{RUN_LABEL[run.state]} · {elapsed}s</span>
        {run.state === 'running' ? (
          <button type="button" className="research-activity-stop" data-ui="research.run-stop" data-ui-key={run.runId}
            title="Stop this research run" aria-label="Stop this research run"
            onClick={(event) => { event.preventDefault(); void window.closedai.research.cancel(run.runId) }}>
            <Square size={11} />
          </button>
        ) : null}
      </summary>
      <div className="research-activity-body">
        <p className="research-activity-meta">
          {run.completedQueries} of {run.queries.length} {run.queries.length === 1 ? 'search' : 'searches'} done
          {' · '}{counts.ready} ready · {counts.reading + counts.queued} reading · {counts.failed} failed
        </p>
        <p className="research-activity-meta">{presentationLine(run)}</p>
        {run.sources.length ? (
          <ul className="research-activity-sources">
            {run.sources.map((source) => (
              <SourceRow key={source.id} source={source} excerpt={excerpts[source.id]}
                onToggle={() => toggle(source.id)} onMore={(offset) => load(source.id, offset)} />
            ))}
          </ul>
        ) : <p className="research-activity-meta">No sources yet.</p>}
        {run.errors.length ? (
          <ul className="research-activity-errors">
            {run.errors.map((error, index) => (
              <li key={index}>{error.provider ? `${error.provider}: ` : ''}{error.message}{error.query ? ` (${error.query})` : ''}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  )
}

function SourceRow({ source, excerpt, onToggle, onMore }: {
  source: ResearchActivitySource
  excerpt?: ExcerptState
  onToggle: () => void
  onMore: (offset: number) => void
}) {
  const last = excerpt?.pages.at(-1)
  return (
    <li className="research-activity-source" data-state={source.state}>
      <div className="research-activity-source-row">
        <StateIcon state={source.state} />
        <button type="button" className="research-activity-source-open" data-ui="research.source-open" data-ui-key={source.id}
          title={source.url} onClick={() => { void window.closedai.browser.openTab(source.url) }}>
          <span className="research-activity-name">{source.title || source.url}</span>
          <ExternalLink size={11} />
        </button>
        <span className="research-activity-meta">
          {sourceHost(source.url)} · {SOURCE_LABEL[source.state]}
          {source.chars !== undefined ? ` · ${Math.round(source.chars / 1000)}k chars` : ''}{source.incomplete ? ' · truncated' : ''}
        </span>
        {source.state === 'ready' ? (
          <button type="button" className="research-activity-excerpt-toggle" data-ui="research.source-excerpt" data-ui-key={source.id}
            aria-pressed={Boolean(excerpt)} title="Show retained text" aria-label="Show retained text" onClick={onToggle}>
            <FileText size={12} />
          </button>
        ) : null}
      </div>
      {source.error ? <p className="research-activity-error">{source.error}</p> : null}
      {excerpt ? (
        <div className="research-activity-excerpt">
          {excerpt.pages.length ? <pre>{excerpt.pages.map((page) => page.text).join('')}</pre> : null}
          {excerpt.error ? <p className="research-activity-error">{excerpt.error}</p> : null}
          {excerpt.loading ? <p className="research-activity-meta">Loading…</p> : null}
          {!excerpt.loading && last?.nextOffset !== null && last?.nextOffset !== undefined ? (
            <button type="button" className="research-activity-more" data-ui="research.source-more" data-ui-key={source.id}
              onClick={() => onMore(last.nextOffset!)}>
              Show more ({Math.round((last.chars - last.nextOffset) / 1000)}k remaining)
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
