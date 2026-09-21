import type { CredentialSummary } from '../../../shared/credentials.js'
import type { CredentialApprovalRequest } from '../../../shared/security.js'

export type CredentialVaultHost = {
  list(): Promise<CredentialSummary[]>
  reveal(credentialId: string, fieldId: string): Promise<string>
}

/** Settings → Security as the read tool sees it. Absent means today's behavior: no approval step. */
export type CredentialAccessPolicy = {
  requireApproval(): boolean
  /** Show the approval card and wait; false on deny, timeout, or an aborted call. */
  approve(request: Omit<CredentialApprovalRequest, 'id' | 'requestedAt'>, signal?: AbortSignal): Promise<boolean>
}

export const AGENT_ACCESS_OFF_MESSAGE =
  'The user has not allowed agents to use this credential. Ask them to enable it in Settings → Security.'
export const APPROVAL_DECLINED_MESSAGE = 'The user declined to share this credential'

export function requireCredentialVault(getVault: () => CredentialVaultHost | null): CredentialVaultHost {
  const vault = getVault()
  if (!vault) throw new Error('Credential vault is not ready')
  return vault
}
