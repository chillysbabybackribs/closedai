import type { JSX } from 'react'
import { useState } from 'react'

import type { ToolCallRecord, ToolFieldInfo, ToolStats } from '../../shared/tools.js'
import { formatRelativeTime } from '../chat-history.js'

export type ToolDetailProps = {
  /** Exactly what the model is told about this tool or action. */
  description: string
  fields: ToolFieldInfo[]
  stat: ToolStats | null
  /** Newest first, already filtered to this item. */
  recent: ToolCallRecord[]
  /** Plain tools only; null hides the schema toggle. */
  inputSchema: unknown
}

/** The expanded body of a tool card: what the model is told, and what it has done. */
export function ToolDetail({ description, fields, stat, recent, inputSchema }: ToolDetailProps): JSX.Element {
  const [showSchema, setShowSchema] = useState(false)
  return (
    <div className="tool-detail">
      <dl className="tool-detail-facts">
        <div><dt>Average time</dt><dd>{stat ? formatMs(stat.averageMs) : '—'}</dd></div>
        <div><dt>Last call</dt><dd>{stat?.lastAt ? formatRelativeTime(stat.lastAt) : 'never'}</dd></div>
      </dl>

      <section className="tool-detail-section">
        <h3>Description the model sees</h3>
        <pre className="tool-detail-description">{description}</pre>
      </section>

      <section className="tool-detail-section">
        <h3>Fields</h3>
        <FieldTable fields={fields} />
      </section>

      {inputSchema !== null && (
        <section className="tool-detail-section">
          <button type="button" className="tool-detail-toggle" onClick={() => setShowSchema((value) => !value)}>
            {showSchema ? 'Hide' : 'Show'} advertised JSON schema
          </button>
          {showSchema && <pre className="tool-detail-schema">{JSON.stringify(inputSchema, null, 2)}</pre>}
        </section>
      )}

      <section className="tool-detail-section">
        <h3>Recent calls</h3>
        {recent.length === 0 ? (
          <p className="tools-modal-empty">No calls recorded yet.</p>
        ) : (
          <ul className="tool-detail-calls">
            {recent.slice(0, 30).map((record) => <CallRow key={record.id} record={record} />)}
          </ul>
        )}
      </section>
    </div>
  )
}

function FieldTable({ fields }: { fields: ToolFieldInfo[] }): JSX.Element {
  if (fields.length === 0) return <p className="tools-modal-empty">No fields.</p>
  return (
    <table className="tool-detail-fields">
      <thead>
        <tr><th>Field</th><th>Type</th><th>Description</th></tr>
      </thead>
      <tbody>
        {fields.map((field) => (
          <tr key={field.name}>
            <td><code>{field.name}</code>{field.required && <span className="tool-detail-required" title="Required">*</span>}</td>
            <td><code>{field.enum ? field.enum.join(' | ') : field.type}</code></td>
            <td>{field.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function CallRow({ record }: { record: ToolCallRecord }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <li className="tool-detail-call" data-ok={record.ok}>
      <button type="button" className="tool-detail-call-summary" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="tool-detail-call-status" aria-label={record.ok ? 'Succeeded' : 'Failed'} />
        <code>{record.action ?? 'call'}</code>
        <span className="tool-detail-call-args">{record.argumentsPreview}</span>
        <span className="tool-detail-call-meta">{formatMs(record.durationMs)} · {formatRelativeTime(record.at)}</span>
      </button>
      {open && (
        <div className="tool-detail-call-body">
          <pre>{record.argumentsPreview}</pre>
          <pre data-tone={record.ok ? undefined : 'bad'}>{record.ok ? record.outputPreview || '(no text output)' : record.error}</pre>
          <p className="tool-detail-hint">thread {record.threadId ?? '—'} · turn {record.turnId ?? '—'} · call {record.callId}</p>
        </div>
      )}
    </li>
  )
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}
