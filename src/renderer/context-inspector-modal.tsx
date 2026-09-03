import type { JSX } from 'react'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.js'
import type { ChatContextUsage, ChatTurnContextReport } from '../shared/chat.js'
import { CHAT_PROVIDER_LABELS } from '../shared/chat-providers.js'

export type ContextInspectorModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  report: ChatTurnContextReport | null
  usage: ChatContextUsage | null
}

export function ContextInspectorModal({ open, onOpenChange, report, usage }: ContextInspectorModalProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="context-inspector" aria-describedby="context-inspector-description" data-ui="dialog.context">
        <header className="context-inspector-header">
          <DialogTitle>Context inspector</DialogTitle>
          <DialogDescription id="context-inspector-description">
            What ClosedAI added to the latest turn on this pane.
          </DialogDescription>
        </header>

        {!report ? <EmptyInspector /> : <ContextReport report={report} usage={usage} />}

        <footer className="context-inspector-footer">
          Text tokens are estimated at four characters per token. Image tokens, provider system instructions,
          and the exact provider-managed history payload are not visible to ClosedAI.
        </footer>
      </DialogContent>
    </Dialog>
  )
}

function ContextReport({ report, usage }: { report: ChatTurnContextReport; usage: ChatContextUsage | null }): JSX.Element {
  return (
    <div className="context-inspector-body">
      <div className="context-inspector-summary">
        <Metric label="Added text" value={`≈${formatNumber(report.estimatedAddedTextTokens)} tokens`} />
        <Metric label="Attachments" value={String(report.attachments.length)} />
        <Metric label="ClosedAI additions" value={String(report.additions.length)} />
        <Metric label="Retained window" value={usage ? `${usage.percent}% · ${formatTokens(usage.usedTokens)}` : 'Provider managed'} />
      </div>

      <section className="context-inspector-section">
        <SectionHeading title="Current user message" meta={`${formatNumber(report.message.characters)} chars · ≈${formatNumber(report.message.estimatedTokens)} tokens`} />
        {report.message.value
          ? <pre className="context-inspector-value">{report.message.value}</pre>
          : <p className="context-inspector-empty">No text; this turn contains attachments only.</p>}
      </section>

      <section className="context-inspector-section">
        <SectionHeading title="Attachments" meta={`${report.attachments.length} sent`} />
        {report.attachments.length ? (
          <ul className="context-inspector-attachments">
            {report.attachments.map((attachment, index) => (
              <li key={`${attachment.name}-${index}`}>
                <div><strong>{attachment.name}</strong><span>{attachment.kind}</span></div>
                <p>{attachment.delivery}</p>
                {attachment.path && <code>{attachment.path}</code>}
              </li>
            ))}
          </ul>
        ) : <p className="context-inspector-empty">No attachments were added to this turn.</p>}
      </section>

      <section className="context-inspector-section">
        <SectionHeading title="ClosedAI additions" meta={`${report.additions.length} injected`} />
        {report.additions.length ? report.additions.map((addition) => (
          <details className="context-inspector-addition" key={addition.name}>
            <summary>
              <span>{addition.name}</span>
              <small>{addition.kind} · {formatNumber(addition.characters)} chars · ≈{formatNumber(addition.estimatedTokens)} tokens</small>
            </summary>
            <pre className="context-inspector-value">{addition.value}</pre>
          </details>
        )) : <p className="context-inspector-empty">None. No browser state or prior-chat handoff was injected.</p>}
      </section>

      <section className="context-inspector-section">
        <SectionHeading title="Provider-retained history" meta={CHAT_PROVIDER_LABELS[report.provider]} />
        <p className="context-inspector-history">{report.retainedHistory}</p>
        {usage && <p className="context-inspector-history">
          Latest measured window: {formatNumber(usage.usedTokens)} of {formatNumber(usage.contextWindow)} tokens ({usage.percent}%).
        </p>}
      </section>

      <p className="context-inspector-stamp">
        Submitted {new Date(report.createdAt).toLocaleString()} · {report.model ?? 'default model'}
      </p>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="context-inspector-metric"><span>{label}</span><strong>{value}</strong></div>
}

function SectionHeading({ title, meta }: { title: string; meta: string }): JSX.Element {
  return <h3 className="context-inspector-section-title"><span>{title}</span><small>{meta}</small></h3>
}

function EmptyInspector(): JSX.Element {
  return <p className="context-inspector-no-report">Send a message to capture its turn context. Reports are kept in memory and reset with the provider surface.</p>
}

function formatTokens(tokens: number): string {
  return tokens >= 1_000 ? `${(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1)}k` : String(tokens)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}
