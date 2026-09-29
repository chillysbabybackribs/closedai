import { useCallback, useEffect, useState, type JSX } from 'react'
import { RefreshCw } from 'lucide-react'

import { Button } from '../../components/ui/button.js'
import { ProviderMark } from '../../components/ui/provider-mark.js'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '../../components/ui/dialog.js'
import type { ChatProvider, ChatSnapshot } from '../../shared/chat.js'
import { CHAT_PROVIDERS, CHAT_PROVIDER_LABELS } from '../../shared/chat-providers.js'
import type { ProviderAvailability } from '../../shared/provider-availability.js'

export type ProviderSetupModalProps = {
  open: boolean
  chat: ChatSnapshot
  connectedProviders: readonly ChatProvider[]
  onLoginCodex: () => Promise<void>
  onMarkConnected: (provider: ChatProvider) => void
  onClearConnected: (provider: ChatProvider) => void
  onContinue: () => void
  onSkip: () => void
}

type ProviderStatus = 'unavailable' | 'available' | 'connected'

function providerStatus(
  provider: ChatProvider,
  availability: ProviderAvailability | undefined,
  chat: ChatSnapshot,
  connectedProviders: readonly ChatProvider[]
): ProviderStatus {
  if (!availability?.installed) return 'unavailable'
  if (connectedProviders.includes(provider)) return 'connected'
  if (chat.provider === provider && chat.connection.state === 'ready') return 'connected'
  if (provider === 'codex' && chat.provider === 'codex' && chat.account) return 'connected'
  return 'available'
}

function statusLabel(status: ProviderStatus): string {
  switch (status) {
    case 'unavailable': return 'Not available on this machine'
    case 'available': return 'Available to connect'
    case 'connected': return 'Connected'
  }
}

export function ProviderSetupModal({
  open,
  chat,
  connectedProviders,
  onLoginCodex,
  onMarkConnected,
  onClearConnected,
  onContinue,
  onSkip
}: ProviderSetupModalProps): JSX.Element {
  const [availability, setAvailability] = useState<ProviderAvailability[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    if (!open) return
    let live = true
    void window.closedai.chat.providerAvailability()
      .then((entries) => { if (live) setAvailability(entries) })
      .catch(() => { if (live) setAvailability(null) })
    return () => { live = false }
  }, [open, refreshTick])

  const refresh = useCallback(() => {
    setRefreshing(true)
    setRefreshTick((tick) => tick + 1)
    void window.closedai.chat.providerAvailability()
      .then((entries) => setAvailability(entries))
      .catch(() => setAvailability(null))
      .finally(() => { setRefreshing(false) })
  }, [])

  const hasConnected = connectedProviders.length > 0 ||
    CHAT_PROVIDERS.some((provider) => providerStatus(provider, availability?.find((row) => row.provider === provider), chat, connectedProviders) === 'connected')

  return (
    <Dialog open={open} onOpenChange={() => { /* first-run modal stays until Continue or Skip */ }}>
      <DialogContent
        className="onboarding-provider-dialog"
        data-ui="dialog.onboarding-providers"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogTitle className="onboarding-provider-title">Connect a provider</DialogTitle>
        <DialogDescription className="onboarding-provider-lede">
          Pick at least one model backend. You can add more later from the model menu.
        </DialogDescription>

        <ul className="onboarding-provider-list">
          {CHAT_PROVIDERS.map((provider) => {
            const entry = availability?.find((row) => row.provider === provider)
            const status = providerStatus(provider, entry, chat, connectedProviders)
            return (
              <li key={provider} className="onboarding-provider-row" data-status={status}>
                <div className="onboarding-provider-mark">
                  <ProviderMark provider={provider} className="size-8" label={CHAT_PROVIDER_LABELS[provider]} />
                </div>
                <div className="onboarding-provider-copy">
                  <span className="onboarding-provider-name">{CHAT_PROVIDER_LABELS[provider]}</span>
                  <span className="onboarding-provider-status">{statusLabel(status)}</span>
                  {entry?.hint && status !== 'connected' && (
                    <p className="onboarding-provider-hint">{entry.hint}</p>
                  )}
                </div>
                <div className="onboarding-provider-actions">
                  {status === 'available' && provider === 'codex' && (
                    <Button type="button" variant="secondary" size="sm" data-ui="onboarding.provider-connect" data-ui-key={provider}
                      onClick={() => void onLoginCodex()}>
                      Connect
                    </Button>
                  )}
                  {status === 'available' && provider !== 'codex' && (
                    <Button type="button" variant="secondary" size="sm" data-ui="onboarding.provider-connect" data-ui-key={provider}
                      onClick={() => onMarkConnected(provider)}>
                      I&apos;ve signed in
                    </Button>
                  )}
                  {status === 'connected' && (
                    <Button type="button" variant="ghost" size="sm" data-ui="onboarding.provider-disconnect" data-ui-key={provider}
                      onClick={() => onClearConnected(provider)}>
                      Disconnect
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        <div className="onboarding-provider-footer">
          <Button type="button" variant="ghost" size="sm" data-ui="onboarding.provider-refresh" disabled={refreshing} onClick={refresh}>
            <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            Check again
          </Button>
          <span className="onboarding-provider-footer-spacer" />
          <Button type="button" variant="ghost" data-ui="onboarding.provider-skip" onClick={onSkip}>Skip for now</Button>
          <Button type="button" data-ui="onboarding.provider-continue" disabled={!hasConnected} onClick={onContinue}>Continue</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
