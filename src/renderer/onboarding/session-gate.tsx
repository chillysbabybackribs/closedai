import { useState, type CSSProperties, type FormEvent, type JSX } from 'react'
import { UserPlus } from 'lucide-react'

import { Button } from '../../components/ui/button.js'
import type { LocalUser } from '../../shared/onboarding.js'
import type { BackdropStatus } from '../backdrop/use-workspace-backdrop.js'

export type SessionGateProps = {
  users: LocalUser[]
  keepSignedIn: boolean
  backdropStatus: BackdropStatus
  onKeepSignedInChange: (value: boolean) => void
  onSignIn: (userId: string) => void
  onCreateAccount: (displayName: string) => void
}

function backdropClass(status: BackdropStatus): string {
  if (status.state === 'ready') return 'onboarding-gate-backdrop onboarding-gate-backdrop-image'
  return 'onboarding-gate-backdrop'
}

export function SessionGate({
  users,
  keepSignedIn,
  backdropStatus,
  onKeepSignedInChange,
  onSignIn,
  onCreateAccount
}: SessionGateProps): JSX.Element {
  const [newName, setNewName] = useState('')
  const style = backdropStatus.state === 'ready'
    ? { backgroundImage: `url(${backdropStatus.image})` }
    : undefined

  const submitCreate = (event: FormEvent): void => {
    event.preventDefault()
    onCreateAccount(newName)
  }

  return (
    <div className="onboarding-gate" data-ui-surface="onboarding-gate" role="dialog" aria-modal="true" aria-labelledby="onboarding-gate-title">
      <div className={backdropClass(backdropStatus)} style={style} aria-hidden="true" />
      <div className="onboarding-gate-scrim" aria-hidden="true" />
      <div className="onboarding-gate-card">
        <p className="onboarding-gate-eyebrow">ClosedAI</p>
        <h1 id="onboarding-gate-title" className="onboarding-gate-title">Sign in</h1>
        <p className="onboarding-gate-lede">Choose a local profile on this machine. Provider accounts connect in the next step.</p>

        {users.length > 0 && (
          <ul className="onboarding-gate-users" aria-label="Existing profiles">
            {users.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  className="onboarding-gate-user"
                  data-ui="onboarding.gate-sign-in"
                  data-ui-key={user.id}
                  onClick={() => onSignIn(user.id)}
                >
                  <span className="onboarding-gate-avatar" style={{ '--avatar-hue': user.avatarHue } as CSSProperties} aria-hidden="true">
                    {user.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="onboarding-gate-user-name">{user.displayName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <form className="onboarding-gate-create" onSubmit={submitCreate}>
          <label className="onboarding-gate-label" htmlFor="onboarding-new-user">Create new account</label>
          <div className="onboarding-gate-create-row">
            <input
              id="onboarding-new-user"
              className="onboarding-gate-input"
              data-ui="onboarding.gate-display-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Display name"
              autoComplete="off"
              maxLength={64}
            />
            <Button type="submit" variant="secondary" data-ui="onboarding.gate-create">
              <UserPlus className="size-4" aria-hidden="true" />
              Create
            </Button>
          </div>
        </form>

        <label className="onboarding-gate-remember">
          <input
            type="checkbox"
            data-ui="onboarding.gate-keep-signed-in"
            checked={keepSignedIn}
            onChange={(event) => onKeepSignedInChange(event.target.checked)}
          />
          Keep me signed in
        </label>
      </div>
    </div>
  )
}
