import type { ChatConnectionState, ChatProvider } from './chat.js'

/** One provider row on the first-run connection modal. */
export type ProviderOnboardingStatus = {
  provider: ChatProvider
  installed: boolean
  connection: ChatConnectionState | 'unknown'
  accountEmail: string | null
}
