import type { JSX } from 'react'

import type { CredentialApprovalRequest, SecurityDecision } from '../shared/security.js'

type Decide = (id: string, decision: SecurityDecision) => void

/**
 * One agent's request to read a saved credential's secret fields, shown above the composer of the
 * chat that asked while Settings → Security → "credentials require approval" is on (off by
 * default). A live region rather than a dialog: the transcript and composer stay usable, and the
 * card leaves on its own once main drops the request (answered elsewhere, or expired).
 */
export function CredentialApprovalCard({ request, onDecide }: { request: CredentialApprovalRequest; onDecide: Decide }): JSX.Element {
  const headingId = `credential-approval-${request.id}`
  return (
    <section className="chat-approval-card" role="region" aria-live="polite" aria-labelledby={headingId} data-request-id={request.id}>
      <h3 id={headingId} className="chat-approval-heading">Agent wants to use a credential</h3>
      <p className="chat-approval-subject">
        <strong>{request.credentialLabel}</strong>
        <span className="chat-approval-service">{request.serviceName}</span>
      </p>
      <ul className="chat-approval-fields" aria-label="Fields requested">
        {request.fieldIds.map((fieldId) => <li key={fieldId}>{fieldId}</li>)}
      </ul>
      {/* The reason is the agent's own words: text content only, never markup. */}
      {request.reason && <p className="chat-approval-reason">{`“${request.reason}”`}</p>}
      <div className="chat-approval-actions">
        <button type="button" className="chat-approval-button" data-ui="chat.credential-allow" data-ui-key={request.id}
          onClick={() => onDecide(request.id, 'allow')}>Allow</button>
        <button type="button" className="chat-approval-button" data-ui="chat.credential-deny" data-ui-key={request.id}
          onClick={() => onDecide(request.id, 'deny')}>Deny</button>
      </div>
    </section>
  )
}

/** Every pending approval for this pane, oldest first, each answerable on its own. */
export function CredentialApprovalCards({ requests, onDecide }: { requests: CredentialApprovalRequest[]; onDecide: Decide }): JSX.Element | null {
  if (requests.length === 0) return null
  return (
    <div className="chat-approval-stack">
      {[...requests].sort((a, b) => a.requestedAt - b.requestedAt).map((request) => (
        <CredentialApprovalCard key={request.id} request={request} onDecide={onDecide} />
      ))}
    </div>
  )
}
