import { useId, useState, type FormEvent, type JSX } from 'react'
import { ArrowLeft } from '../icons/index.js'

import { Button } from '../../components/ui/button.js'
import type { LocalUser } from '../../shared/onboarding.js'
import { PasswordField, UserAvatar } from './session-gate-parts.js'
import type { SessionGateDeleteResult } from './use-onboarding.js'

export type DeleteAccountPanelProps = {
  user: LocalUser
  onBack: () => void
  onDelete: (userId: string, password: string) => Promise<SessionGateDeleteResult>
  onDeleted: () => void
}

/** The gate's last step before an account and its workspace are removed. */
export function DeleteAccountPanel({ user, onBack, onDelete, onDeleted }: DeleteAccountPanelProps): JSX.Element {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const passwordFieldId = useId()
  const needsPassword = Boolean(user.passwordHash)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    setError(null)
    if (needsPassword && !password) {
      setError('Enter the password for this account.')
      return
    }
    setBusy(true)
    const result = await onDelete(user.id, password)
    setBusy(false)
    if (result.ok) {
      onDeleted()
      return
    }
    setError(result.reason === 'wrong-password' ? 'Incorrect password.' : 'Could not delete this account.')
  }

  return (
    <div className="onboarding-gate-panel onboarding-gate-panel-auth">
      <button type="button" className="onboarding-gate-back" data-ui="onboarding.gate-back" onClick={onBack}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back
      </button>

      <div className="onboarding-gate-auth-header">
        <UserAvatar user={user} large />
        <h1 className="onboarding-gate-auth-name">Delete {user.displayName}?</h1>
        <p className="onboarding-gate-auth-hint">
          This removes the account and its workspace: chats, notes, layout, browser data and saved
          credentials. The data is moved to the trash.
        </p>
      </div>

      <form className="onboarding-gate-auth-form" onSubmit={submit}>
        {needsPassword ? (
          <PasswordField
            id={passwordFieldId}
            label="Password"
            value={password}
            autoComplete="current-password"
            kind="sign-in"
            autoFocus
            onChange={setPassword}
          />
        ) : null}

        {error ? <p className="onboarding-gate-error" role="alert">{error}</p> : null}

        <Button
          type="submit"
          variant="destructive"
          className="onboarding-gate-submit"
          data-ui="onboarding.gate-delete-confirm"
          data-ui-key={user.id}
          disabled={busy}
        >
          Delete account
        </Button>
      </form>
    </div>
  )
}
