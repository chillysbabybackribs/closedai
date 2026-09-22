import { Check } from 'lucide-react'

import type { CatchUpReport } from './project-catchup.js'
import type { Location } from './project-files.js'
import { absolute, duration, relative } from './project-time.js'

/** The catch-up report as a stage page: short, priority-descending, every line a link. */
export function CatchUpDetail(props: {
  report: CatchUpReport
  onNavigate: (location: Location) => void
  onCaughtUp: () => void
}) {
  const { report, onNavigate, onCaughtUp } = props
  const away = duration(report.now - report.since)
  return <article className="project-detail is-catchup">
    <header className="project-detail-heading">
      <span className="project-detail-kind">Catch-up · since {absolute(report.since, report.now)}</span>
      <h1>{report.total ? `${report.total} ${report.total === 1 ? 'change' : 'changes'} in ${away}` : `Quiet for ${away}`}</h1>
      <button type="button" className="project-detail-edit" data-ui="preview.project-caught-up" onClick={onCaughtUp}>
        <Check size={12} aria-hidden="true" /> Caught up
      </button>
    </header>
    {!report.total && <p className="project-detail-serves">Nothing changed since you last caught up. Work in progress is still on the map.</p>}
    {report.sections.map((section) => <section key={section.tone} className="project-catchup-section" data-tone={section.tone}>
      <h2>{section.title}<span>{section.items.length + section.more}</span></h2>
      <ol>
        {section.items.map((item, index) => <li key={`${section.tone}-${index}`}>
          <button type="button" data-ui="preview.project-catchup-item" data-ui-key={`${section.tone}-${index}`}
            onClick={() => onNavigate(item.location)}>
            <time dateTime={new Date(item.at).toISOString()} title={absolute(item.at, report.now)}>{relative(item.at, report.now)}</time>
            <span>{item.text}</span>
          </button>
        </li>)}
        {section.more > 0 && <li className="project-catchup-more">and {section.more} more</li>}
      </ol>
    </section>)}
  </article>
}
