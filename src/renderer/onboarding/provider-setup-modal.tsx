import { useCallback, useEffect, useState, type JSX } from 'react'
import { RefreshCw } from '../icons/index.js'

import { Button } from '../../components/ui/button.js'
import { ProviderMark } from '../../components/ui/provider-mark.js'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '../../components/ui/dialog.js'
import type { ChatProvider } from '../../shared/chat.js'
import { CHAT_PROVIDERS, CHAT_PROVIDER_LABELS } from '../../shared/chat-providers.js'
import type { ProviderOnboardingStatus } from '../../shared/provider-onboarding.js'
import { PROVIDER_INSTALL_HINTS } from '../../shared/provider-install-hints.js'

export type ProviderSetupModalProps = {
  open: boolean
  connectedProviders: readonly ChatProvider[]
  onSignInProvider: (provider: ChatProvider) => Promise<void>
  onMarkConnected: (provider: ChatProvider) => void
  onClearConnected: (provider: ChatProvider) => void
  onContinue: () => void
  onSkip: () => void
}

type RowStatus = 'unavailable' | 'disconnected' | 'connected'

function rowStatus(
  row: ProviderOnboardingStatus,
  connectedProviders: readonly ChatProvider[]
): RowStatus {
  if (!row.installed || row.connection === 'unavailable') return 'unavailable'
  if (connectedProviders.includes(row.provider)) return 'connected'
  if (row.connection === 'ready') return 'connected'
  return 'disconnected'
}

function statusLabel(status: RowStatus, row: ProviderOnboardingStatus): string {
  switch (status) {
    case 'unavailable': return 'Not installed'
    case 'disconnected': return row.connection === 'unknown' ? 'Checking sign-in…' : 'Not connected'
    case 'connected':
      return row.accountEmail ? `Connected · ${row.accountEmail}` : 'Connected'
  }
}

function installHint(provider: ChatProvider): string {
  return PROVIDER_INSTALL_HINTS[provider]
}

export function ProviderSetupModal({
  open,
  connectedProviders,
  onSignInProvider,
  onMarkConnected,
  onClearConnected,
  onContinue,
  onSkip
}: ProviderSetupModalProps): JSX.Element {
  const [rows, setRows] = useState<ProviderOnboardingStatus[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [signingIn, setSigningIn] = useState<ChatProvider | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await window.closedai.chat.providerOnboarding()
      setRows(next)
      for (const row of next) {
        if (row.connection === 'ready') onMarkConnected(row.provider)
      }
    } catch {
      setRows(null)
    }
  }, [onMarkConnected])

  useEffect(() => {
    if (!open) return
    void load()
    const timer = window.setInterval(() => { void load() }, 8000)
    return () => window.clearInterval(timer)
  }, [load, open])

  const refresh = useCallback(() => {
    setRefreshing(true)
    void load().finally(() => { setRefreshing(false) })
  }, [load])

  const signIn = useCallback((provider: ChatProvider) => {
    setSigningIn(provider)
    void onSignInProvider(provider)
      .then(() => load())
      .finally(() => { setSigningIn(null) })
  }, [load, onSignInProvider])

  const hasConnected = connectedProviders.length > 0 ||
    (rows?.some((row) => rowStatus(row, connectedProviders) === 'connected') ?? false)

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
          Link at least one model backend for this profile. Signed-in CLIs are detected automatically.
        </DialogDescription>

        <ul className="onboarding-provider-list">
          {CHAT_PROVIDERS.map((provider) => {
            const row = rows?.find((entry) => entry.provider === provider) ?? {
              provider,
              installed: false,
              connection: 'unknown' as const,
              accountEmail: null
            }
            const status = rowStatus(row, connectedProviders)
            return (
              <li key={provider} className="onboarding-provider-row" data-status={status}>
                <div className="onboarding-provider-mark">
                  <ProviderMark provider={provider} className="size-8" label={CHAT_PROVIDER_LABELS[provider]} />
                </div>
                <div className="onboarding-provider-copy">
                  <span className="onboarding-provider-name">{CHAT_PROVIDER_LABELS[provider]}</span>
                  <span className="onboarding-provider-status">{statusLabel(status, row)}</span>
                  {status === 'unavailable' && (
                    <p className="onboarding-provider-hint">{installHint(provider)}</p>
                  )}
                </div>
                <div className="onboarding-provider-actions">
                  {status === 'disconnected' && (
                    <button
                      type="button"
                      className="onboarding-provider-sign-in"
                      data-ui="onboarding.provider-sign-in"
                      data-ui-key={provider}
                      disabled={signingIn === provider}
                      onClick={() => signIn(provider)}
                    >
                      {signingIn === provider ? 'Opening…' : 'Sign in'}
                    </button>
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
