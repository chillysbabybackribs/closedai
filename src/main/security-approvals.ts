import type { CredentialApprovalRequest } from '../shared/security.js'
import { DecisionBroker } from './decision-broker.js'

/** How long an approval card waits in the chat before the read is denied on the user's behalf. */
export const CREDENTIAL_APPROVAL_TIMEOUT_MS = 120_000

/**
 * Credential read approvals, shown as a card in the requesting chat while Settings → Security has
 * `credentialsRequireApproval` on. The tool awaits the answer; the renderer mirrors the pending list.
 */
export class CredentialApprovalBroker extends DecisionBroker<CredentialApprovalRequest> {
  constructor(timeoutMs = CREDENTIAL_APPROVAL_TIMEOUT_MS) {
    super(timeoutMs)
  }
}
