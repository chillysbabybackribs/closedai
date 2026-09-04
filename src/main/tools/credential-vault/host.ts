import type { CredentialSummary } from '../../../shared/credentials.js'

export type CredentialVaultHost = {
  list(): Promise<CredentialSummary[]>
  reveal(credentialId: string, fieldId: string): Promise<string>
}

export function requireCredentialVault(getVault: () => CredentialVaultHost | null): CredentialVaultHost {
  const vault = getVault()
  if (!vault) throw new Error('Credential vault is not ready')
  return vault
}
