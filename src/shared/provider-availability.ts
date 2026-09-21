import type { ChatProvider } from './chat.js'

/**
 * Whether one chat provider's backend can be started on this machine. Read once for a first-run
 * or onboarding screen; sign-in is a separate step that each provider reports on its own
 * `ChatConnection` once a pane starts it.
 */
export type ProviderAvailability = {
  provider: ChatProvider
  /** The provider's executable (or, for Claude, its bundled runtime) is present. */
  installed: boolean
  /** Resolved executable path when an external binary was found; null when missing or bundled. */
  path: string | null
  /** One sentence a UI can show: how to install when missing, how to sign in when installed. */
  hint: string
}
