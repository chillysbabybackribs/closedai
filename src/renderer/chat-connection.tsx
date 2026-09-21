import { useEffect, useState, type JSX } from 'react'
import { LogIn } from 'lucide-react'

import { Button } from '../components/ui/button.js'
import type { ChatConnectionState, ChatProvider } from '../shared/chat.js'
import { CHAT_PROVIDER_LABELS } from '../shared/chat-providers.js'
import type { ProviderAvailability } from '../shared/provider-availability.js'

/**
 * Which providers this machine can start, read once per blocked pane. Null until known; a
 * failed read stays null so the empty state falls back to main's message alone.
 */
export function useProviderAvailability(enabled: boolean): ProviderAvailability[] | null {
  const [availability, setAvailability] = useState<ProviderAvailability[] | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    window.closedai.chat.providerAvailability()
      .then((entries) => { if (live) setAvailability(entries) })
      .catch(() => { /* keep the message-only empty state */ })
    return () => { live = false }
  }, [enabled])
  return availability
}

/** The empty pane's heading: what stands between the user and a first message. */
export function connectionHeading(provider: ChatProvider, state: ChatConnectionState): string {
  const label = CHAT_PROVIDER_LABELS[provider]
  switch (state) {
    case 'signed-out': return `Sign in to ${label}`
    case 'unavailable': case 'error': return `${label} is unavailable`
    case 'starting': return `Starting ${label}…`
    case 'ready': return `Start with ${label}`
  }
}

/** Only Codex signs in from the pane; Claude Code and the CLIs sign in from their own tools. */
function offersSignIn(provider: ChatProvider, state: ChatConnectionState): boolean {
  return state === 'signed-out' && provider === 'codex'
}

/** A blocked provider is one pick away from another; every blocked state says so. */
function offersModelSwitch(state: ChatConnectionState): boolean {
  return state === 'signed-out' || state === 'unavailable' || state === 'error'
}

type ConnectionGuidanceProps = {
  provider: ChatProvider
  state: ChatConnectionState
  /** Main's guidance for this state: install steps, the sign-in path, or the failure. */
  message: string
  onLogin: () => Promise<void>
  onChooseModel: () => void
}

/** What each provider needs on this machine, so a first run does not stop at one missing CLI. */
function ProviderList({ entries, current }: { entries: ProviderAvailability[]; current: ChatProvider }): JSX.Element {
  return (
    <ul className="chat-provider-list" aria-label="Providers on this machine">
      {entries.map((entry) => (
        <li key={entry.provider} data-installed={entry.installed} aria-current={entry.provider === current ? 'true' : undefined}>
          <span className="chat-provider-name">{CHAT_PROVIDER_LABELS[entry.provider]}</span>
          <span className="chat-provider-status">{entry.installed ? 'Installed' : 'Not installed'}</span>
        </li>
      ))}
    </ul>
  )
}

/** The centered guidance an empty pane shows while its provider cannot take a message. */
export function EmptyState({
  provider, state, message, onLogin, onChooseModel, availability = null
}: ConnectionGuidanceProps & { availability?: ProviderAvailability[] | null }): JSX.Element {
  return (
    <div className="prompt-chat-empty chat-empty">
      <h2>{connectionHeading(provider, state)}</h2>
      <p>{message}</p>
      {offersModelSwitch(state) && availability && availability.length > 0 && (
        <ProviderList entries={availability} current={provider} />
      )}
      {offersSignIn(provider, state) && (
        <Button type="button" variant="secondary" data-ui="chat.sign-in" onClick={() => void onLogin()}>
          <LogIn className="size-4" aria-hidden="true" />
          Sign in with ChatGPT
        </Button>
      )}
      {offersModelSwitch(state) && (
        <p className="chat-empty-hint">
          Choose another model to use a different provider.
          <button type="button" className="chat-connection-link" data-ui="chat.choose-model" onClick={onChooseModel}>Choose model</button>
        </p>
      )}
    </div>
  )
}

/**
 * The same guidance as a strip above the composer once a transcript exists: the messages stay
 * readable and the reason the next one cannot be sent is still in view.
 */
export function ConnectionBanner({ provider, state, message, onLogin, onChooseModel }: ConnectionGuidanceProps): JSX.Element {
  return (
    <div className="chat-connection-banner" role="status" data-state={state}>
      <span className="chat-connection-banner-text">
        <strong>{connectionHeading(provider, state)}</strong> {message}
      </span>
      <span className="chat-connection-banner-actions">
        {offersSignIn(provider, state) && (
          <button type="button" className="chat-connection-link" data-ui="chat.sign-in" onClick={() => void onLogin()}>
            Sign in with ChatGPT
          </button>
        )}
        {offersModelSwitch(state) && (
          <button type="button" className="chat-connection-link" data-ui="chat.choose-model" onClick={onChooseModel}>Choose model</button>
        )}
      </span>
    </div>
  )
}
