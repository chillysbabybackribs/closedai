import { useState, type JSX } from 'react'
import { BookOpen, RefreshCw } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog.js'
import type { LibrarySnapshot } from '../../shared/research-library.js'
import { useResearchLibrary } from './library-controller.js'

const REFRESH_STATE_LABELS: Record<NonNullable<LibrarySnapshot['lastRefresh']>['state'], string> = {
  completed: 'Completed',
  partial: 'Partly completed',
  failed: 'Failed',
  cancelled: 'Stopped',
  timed_out: 'Timed out'
}

function date(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function ResearchLibraryDialog({ open, onOpenChange }: {
  open: boolean; onOpenChange: (open: boolean) => void
}): JSX.Element {
  const library = useResearchLibrary(open)
  const [filter, setFilter] = useState('')
  const [limit, setLimit] = useState(20)
  const snapshot = library.snapshot
  const refreshing = snapshot?.refreshing ?? false
  const locked = library.busy || refreshing
  const papers = snapshot?.papers.filter((paper) =>
    `${paper.title} ${paper.abstract} ${paper.topics.join(' ')}`.toLowerCase().includes(filter.toLowerCase())) ?? []
  const last = snapshot?.lastRefresh

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="research-library-dialog" data-ui="dialog.research-library" aria-describedby="research-library-description">
        <header className="research-library-heading">
          <BookOpen size={20} aria-hidden="true" />
          <div>
            <DialogTitle>Research library</DialogTitle>
            <DialogDescription id="research-library-description">
              Recent papers for your work, available across projects when relevant.
            </DialogDescription>
          </div>
        </header>
        <div className="research-library-body">
          {library.error && <p className="research-library-error" role="alert">{library.error}</p>}
          {!snapshot && library.error && (
            <div className="research-library-actions">
              <button type="button" onClick={library.retryLoad}>Try again</button>
            </div>
          )}
          {!snapshot && !library.error && <p role="status">Loading library…</p>}
          {snapshot && <>
            <section className="research-library-settings" aria-label="Research topics">
              <label htmlFor="research-library-topics">Topics to follow</label>
              <textarea id="research-library-topics" data-ui="research.topics" value={library.topics}
                disabled={locked} rows={3} maxLength={1004}
                aria-describedby="research-library-topics-help"
                onChange={(event) => library.setTopics(event.target.value)} />
              <p id="research-library-topics-help" className="research-library-muted">
                One topic per line, up to five. Only these topics are sent to alphaXiv when you update.
              </p>
              <div className="research-library-row">
                <label htmlFor="research-library-window">Publication window</label>
                <select id="research-library-window" data-ui="research.window" value={library.days}
                  disabled={locked} onChange={(event) => library.setDays(Number(event.target.value))}>
                  {[7, 30, 90, 180, 365].map((days) => <option key={days} value={days}>Past {days} days</option>)}
                </select>
              </div>
              <label className="research-library-row">
                <input type="checkbox" data-ui="research.enabled" checked={library.enabled} disabled={locked}
                  onChange={(event) => library.setEnabled(event.target.checked)} />
                Allow agents to search this library when relevant
              </label>
              <p className="research-library-muted">
                Updates fetch public titles and abstracts without model calls. Papers are retrieved on demand, never automatically added to chats.
              </p>
              <div className="research-library-actions">
                <button type="button" data-ui="research.save" disabled={locked || !library.dirty || !library.valid}
                  onClick={() => { void library.save() }}>Save topics &amp; settings</button>
                <button type="button" data-ui="research.refresh" className="research-library-primary"
                  disabled={locked || library.dirty} onClick={library.refresh}>
                  <RefreshCw size={14} aria-hidden="true" />{refreshing ? 'Updating…' : 'Update research'}
                </button>
                {refreshing && <button type="button" data-ui="research.cancel" onClick={library.cancel}>Stop update</button>}
              </div>
              {library.dirty && <p className="research-library-muted">
                {library.valid ? 'Save your changes before updating.' : 'Enter 1–5 topics, each between 3 and 200 characters.'}
              </p>}
            </section>
            <section aria-label="Saved papers" className="research-library-papers">
              <div className="research-library-row research-library-spread">
                <strong>{snapshot.total} saved {snapshot.total === 1 ? 'paper' : 'papers'}</strong>
                {snapshot.dismissed > 0 && <button type="button" data-ui="research.restore" disabled={locked}
                  onClick={() => { void library.restore() }}>Restore dismissed ({snapshot.dismissed})</button>}
              </div>
              <p className="research-library-muted" role="status">
                {refreshing ? 'Checking your topics. Closing this window keeps the update running.' : last
                  ? `Last update ${date(last.finishedAt)} · ${REFRESH_STATE_LABELS[last.state]} · ${last.added} added`
                  : 'Choose your topics and update to collect your first papers.'}
              </p>
              {last?.errors.map((error, index) => <p className="research-library-error" key={`${error.topic}-${index}`}>
                {error.topic}: {error.message}
              </p>)}
              <label className="research-library-filter">
                <span>Filter saved papers</span>
                <input type="search" data-ui="research.filter" value={filter} placeholder="Title, abstract, or topic"
                  onChange={(event) => { setFilter(event.target.value); setLimit(20) }} />
              </label>
              {!papers.length && <p className="research-library-muted">
                {snapshot.total ? 'No saved papers match this filter.' : 'No papers in the selected publication window yet.'}
              </p>}
              {papers.slice(0, limit).map((paper) => <article className="research-library-paper" key={paper.id}>
                <button type="button" data-ui="research.paper-open" data-ui-key={paper.id}
                  className="research-library-paper-title" onClick={() => library.openPaper(paper.url)}>{paper.title}</button>
                <p className="research-library-muted">Published {date(paper.publishedAt)} · Retrieved {date(paper.retrievedAt)} · alphaXiv</p>
                <p className="research-library-muted">{paper.topics.join(' · ')}</p>
                <details>
                  <summary data-ui="research.paper-details" data-ui-key={paper.id}>Abstract</summary>
                  <p className="research-library-abstract">{paper.abstract || 'No abstract available.'}</p>
                  <p className="research-library-muted">{paper.abstractTruncated ? 'Abstract shortened. ' : ''}Discovery evidence; findings have not been verified.</p>
                </details>
                <button type="button" data-ui="research.paper-dismiss" data-ui-key={paper.id}
                  disabled={locked} onClick={() => { void library.dismiss(paper.id) }}>Dismiss</button>
              </article>)}
              {papers.length > limit && <button type="button" data-ui="research.more" onClick={() => setLimit(limit + 20)}>
                Show more ({papers.length - limit} remaining)
              </button>}
            </section>
          </>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
