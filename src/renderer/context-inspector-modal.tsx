import type { JSX } from 'react'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.js'
import type { ChatContextUsage, ChatTurnContextReport } from '../shared/chat.js'
import { CHAT_PROVIDER_LABELS } from '../shared/chat-providers.js'
import type { ChatMemoryCheckpoint } from '../shared/chat-memory.js'

export type ContextInspectorModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  report: ChatTurnContextReport | null
  usage: ChatContextUsage | null
  checkpoint?: ChatMemoryCheckpoint | null
}

export function ContextInspectorModal({ open, onOpenChange, report, usage, checkpoint = null }: ContextInspectorModalProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="context-inspector" aria-describedby="context-inspector-description" data-ui="dialog.context">
        <header className="context-inspector-header">
          <DialogTitle>Context inspector</DialogTitle>
          <DialogDescription id="context-inspector-description">
            What ClosedAI and the active agent maintain for this conversation.
          </DialogDescription>
        </header>

        {!report && !checkpoint ? <EmptyInspector /> : <ContextReport report={report} usage={usage} checkpoint={checkpoint} />}

        <footer className="context-inspector-footer">
          Text tokens are estimated at four characters per token. Image tokens, provider system instructions,
          and the exact provider-managed history payload are not visible to ClosedAI.
        </footer>
      </DialogContent>
    </Dialog>
  )
}

function ContextReport({
  report,
  usage,
  checkpoint
}: {
  report: ChatTurnContextReport | null
  usage: ChatContextUsage | null
  checkpoint: ChatMemoryCheckpoint | null
}): JSX.Element {
  return (
    <div className="context-inspector-body">
      <div className="context-inspector-summary">
        <Metric label="Added text" value={report ? `≈${formatNumber(report.estimatedAddedTextTokens)} tokens` : '—'} />
        <Metric label="Attachments" value={report ? String(report.attachments.length) : '0'} />
        <Metric label="ClosedAI additions" value={report ? String(report.additions.length) : '0'} />
        <Metric label="Retained window" value={usage ? `${usage.percent}% · ${formatTokens(usage.usedTokens)}` : 'Provider managed'} />
      </div>

      {checkpoint ? (
        <CheckpointSection checkpoint={checkpoint} />
      ) : (
        <section className="context-inspector-section">
          <SectionHeading title="Working memory" meta="No checkpoint saved" />
          <p className="context-inspector-empty">
            No working notes saved for this chat yet. Multi-step agents record goals, progress, and decisions with peer_chats.checkpoint.
          </p>
        </section>
      )}

      {report ? (
        <>
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
        </>
      ) : (
        <p className="context-inspector-stamp">No turn submitted yet in this session.</p>
      )}
    </div>
  )
}

function CheckpointSection({ checkpoint }: { checkpoint: ChatMemoryCheckpoint }): JSX.Element {
  const { state, revision, createdAt } = checkpoint
  const age = formatAge(createdAt)
  return (
    <section className="context-inspector-section context-inspector-checkpoint">
      <SectionHeading
        title="Working memory (checkpoint)"
        meta={`Revision ${revision}${age ? ` · Updated ${age}` : ''}`}
      />
      <div className="checkpoint-card">
        <div className="checkpoint-goal">
          <span className="checkpoint-badge">Goal</span>
          <p className="checkpoint-goal-text">{state.goal}</p>
        </div>

        {(state.progress.length > 0 || state.nextSteps.length > 0) && (
          <div className="checkpoint-grid">
            <div className="checkpoint-column">
              <h4 className="checkpoint-subheading">Progress ({state.progress.length})</h4>
              {state.progress.length > 0 ? (
                <ul className="checkpoint-list checkpoint-progress">
                  {state.progress.map((item, i) => (
                    <li key={i}>
                      <span className="checkpoint-icon checkpoint-icon-done" aria-hidden="true">✓</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="context-inspector-empty">No completed steps recorded yet.</p>
              )}
            </div>
            <div className="checkpoint-column">
              <h4 className="checkpoint-subheading">Next steps ({state.nextSteps.length})</h4>
              {state.nextSteps.length > 0 ? (
                <ul className="checkpoint-list checkpoint-next">
                  {state.nextSteps.map((item, i) => (
                    <li key={i}>
                      <span className="checkpoint-icon checkpoint-icon-next" aria-hidden="true">➔</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="context-inspector-empty">No next steps planned.</p>
              )}
            </div>
          </div>
        )}

        {(state.decisions.length > 0 || state.constraints.length > 0) && (
          <div className="checkpoint-grid">
            <div className="checkpoint-column">
              <h4 className="checkpoint-subheading">Decisions ({state.decisions.length})</h4>
              {state.decisions.length > 0 ? (
                <ul className="checkpoint-list checkpoint-decisions">
                  {state.decisions.map((item, i) => (
                    <li key={i}>
                      <span className="checkpoint-icon checkpoint-icon-decision" aria-hidden="true">✦</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="context-inspector-empty">No architectural decisions recorded.</p>
              )}
            </div>
            <div className="checkpoint-column">
              <h4 className="checkpoint-subheading">Constraints ({state.constraints.length})</h4>
              {state.constraints.length > 0 ? (
                <ul className="checkpoint-list checkpoint-constraints">
                  {state.constraints.map((item, i) => (
                    <li key={i}>
                      <span className="checkpoint-icon checkpoint-icon-constraint" aria-hidden="true">⚠</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="context-inspector-empty">No constraints specified.</p>
              )}
            </div>
          </div>
        )}

        {state.files.length > 0 && (
          <div className="checkpoint-files">
            <h4 className="checkpoint-subheading">Relevant files ({state.files.length})</h4>
            <div className="checkpoint-file-tags">
              {state.files.map((file, i) => (
                <button
                  key={i}
                  type="button"
                  className="checkpoint-file-tag"
                  title={`Open ${file}`}
                  onClick={() => {
                    const href = file.startsWith('file://') ? file : `file://${file.startsWith('/') ? '' : '/'}${file}`
                    void window.closedai.localFiles.open(href)
                  }}
                >
                  <code>{file}</code>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
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

function formatAge(timestamp: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return ''
  const elapsedMs = Math.max(0, Date.now() - timestamp)
  const seconds = Math.round(elapsedMs / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}
