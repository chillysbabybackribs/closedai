import { Check, CheckCircle2, Circle, ExternalLink } from 'lucide-react'

import type { CatchUpReport } from './project-catchup.js'
import { bare, type AcknowledgedReport, type Progress, type Proposal } from './project-closure.js'
import type { DirectionRecord } from './project-discovery.js'
import type { Location } from './project-files.js'
import { absolute, duration, relative } from './project-time.js'

/** Completion progress as five gates; the same strip appears in every report and the proposal. */
export function GateStrip({ progress, onNavigate }: { progress: Progress; onNavigate: (location: Location) => void }) {
  return <ol className="project-gates" aria-label={`Completion progress: ${progress.met} of ${progress.total} gates`}>
    {progress.gates.map((gate) => <li key={gate.id} data-met={gate.met || undefined}>
      <button type="button" data-ui="agent.project-gate" data-ui-key={gate.id} title={gate.evidence}
        onClick={() => gate.nodeId && onNavigate({ kind: 'node', id: gate.nodeId })}>
        {gate.met ? <CheckCircle2 size={12} aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}
        {gate.label}
      </button>
    </li>)}
  </ol>
}

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
      <span className="project-detail-kind">Progress report · since {absolute(report.since, report.now)}</span>
      <h1>{report.total ? `${report.total} ${report.total === 1 ? 'change' : 'changes'} in ${away}` : `Quiet for ${away}`}</h1>
      <button type="button" className="project-detail-edit" data-ui="agent.project-caught-up" onClick={onCaughtUp}>
        <Check size={12} aria-hidden="true" /> Caught up
      </button>
      <p className="project-detail-stamps">
        <span>Completion {report.progress.met} of {report.progress.total} gates</span>
        <span>Acknowledging files this report under reports/ and lets the coordinator build on it</span>
      </p>
    </header>
    <GateStrip progress={report.progress} onNavigate={onNavigate} />
    {!report.total && <p className="project-detail-serves">Nothing changed since you last caught up. Work in progress is still on the map.</p>}
    {report.sections.map((section) => <section key={section.tone} className="project-catchup-section" data-tone={section.tone}>
      <h2>{section.title}<span>{section.items.length + section.more}</span></h2>
      <ol>
        {section.items.map((item, index) => <li key={`${section.tone}-${index}`}>
          <button type="button" data-ui="agent.project-catchup-item" data-ui-key={`${section.tone}-${index}`}
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

/** The coordinator's completion proposal: what it rests on, the gates, and the acceptance walk. */
export function ProposalDetail(props: {
  proposal: Proposal
  reports: AcknowledgedReport[]
  progress: Progress
  record: DirectionRecord
  acceptedAt: number | null
  now: number
  onNavigate: (location: Location) => void
  onAccept: () => void
}) {
  const { proposal, reports, progress, record, acceptedAt, now, onNavigate, onAccept } = props
  const licensing = reports.find((report) => report.id === proposal.reportId)
  const index = licensing ? reports.indexOf(licensing) : -1
  return <article className="project-detail is-proposal">
    <header className="project-detail-heading">
      <span className="project-detail-kind">Root coordinator · {absolute(proposal.at, now)}</span>
      <h1>{acceptedAt ? 'Complete' : 'Completion proposed'}</h1>
      {acceptedAt
        ? <span className="project-detail-state" data-state="complete">accepted {relative(acceptedAt, now)}</span>
        : <button type="button" className="project-detail-edit is-accept" data-ui="agent.project-accept" onClick={onAccept}>
          <Check size={12} aria-hidden="true" /> Accept
        </button>}
      <p className="project-detail-stamps">
        <span>Rests on report {index + 1}{licensing ? `, acknowledged ${relative(licensing.at, now)}` : ''}</span>
        <span>{reports.length} report{reports.length === 1 ? '' : 's'} on record · nothing changed since</span>
      </p>
    </header>
    <GateStrip progress={progress} onNavigate={onNavigate} />
    <section className="project-detail-section">
      <h2>Acceptance walk</h2>
      <ol className="project-walk">
        <li>Open the application as {bare(record.user, 'the primary user')}.</li>
        <li>{bare(record.journey, 'Complete the first useful session')}.</li>
        <li>Confirm it stayed within: {bare(record.boundaries, 'the stated boundaries')}.</li>
      </ol>
    </section>
    <section className="project-detail-section">
      <h2>Traceable record</h2>
      <ul className="project-detail-list">
        {reports.map((report, position) => <li key={report.id}>
          <button type="button" data-ui="agent.project-file" data-ui-key={`reports/${String(position + 1).padStart(2, '0')}-progress.md`}
            onClick={() => onNavigate({ kind: 'file', path: `reports/${String(position + 1).padStart(2, '0')}-progress.md` })}>
            <strong>Report {position + 1} · {report.progress.met}/{report.progress.total} gates</strong>
            <small>{report.changes} changes · acknowledged {absolute(report.at, now)}</small>
          </button>
        </li>)}
      </ul>
    </section>
    {!acceptedAt && <p className="project-detail-serves">
      <b>Or</b> name the gap in the composer below; it becomes an amendment and this proposal is withdrawn.
    </p>}
    {acceptedAt && <p className="project-detail-serves">
      <b>Handoff</b> <button type="button" className="project-inline-link" data-ui="agent.project-file" data-ui-key="handoff.md"
        onClick={() => onNavigate({ kind: 'file', path: 'handoff.md' })}>handoff.md <ExternalLink size={10} aria-hidden="true" /></button>
    </p>}
  </article>
}
