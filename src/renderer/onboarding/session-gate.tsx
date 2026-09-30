import { useId, useState, type CSSProperties, type FormEvent, type JSX } from 'react'
import { ArrowLeft, Eye, EyeOff, UserPlus } from 'lucide-react'

import { Button } from '../../components/ui/button.js'
import type { LocalUser } from '../../shared/onboarding.js'
import type { BackdropStatus } from '../backdrop/use-workspace-backdrop.js'
import type { SessionGateCreateResult, SessionGateSignInResult } from './use-onboarding.js'

export type SessionGateProps = {
  users: LocalUser[]
  keepSignedIn: boolean
  backdropStatus: BackdropStatus
  onKeepSignedInChange: (value: boolean) => void
  onSignIn: (userId: string, password: string) => Promise<SessionGateSignInResult>
  onSetProfilePassword: (userId: string, password: string) => Promise<SessionGateSignInResult>
  onCreateAccount: (displayName: string, password: string) => Promise<SessionGateCreateResult>
}

type GateScreen = 'users' | 'password' | 'create'

function backdropClass(status: BackdropStatus): string {
  if (status.state === 'ready') return 'onboarding-gate-backdrop onboarding-gate-backdrop-image'
  return 'onboarding-gate-backdrop'
}

type PasswordFieldKind = 'sign-in' | 'new' | 'confirm'

type PasswordFieldProps = {
  id: string
  label: string
  value: string
  autoComplete: string
  kind: PasswordFieldKind
  autoFocus?: boolean
  onChange: (value: string) => void
}

function PasswordField({
  id,
  label,
  value,
  autoComplete,
  kind,
  autoFocus,
  onChange
}: PasswordFieldProps): JSX.Element {
  const [visible, setVisible] = useState(false)
  const input = kind === 'sign-in' ? (
    <input
      id={id}
      className="onboarding-gate-input onboarding-gate-password-input"
      data-ui="onboarding.gate-password"
      type={visible ? 'text' : 'password'}
      value={value}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
    />
  ) : kind === 'new' ? (
    <input
      id={id}
      className="onboarding-gate-input onboarding-gate-password-input"
      data-ui="onboarding.gate-new-password"
      type={visible ? 'text' : 'password'}
      value={value}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
    />
  ) : (
    <input
      id={id}
      className="onboarding-gate-input onboarding-gate-password-input"
      data-ui="onboarding.gate-confirm-password"
      type={visible ? 'text' : 'password'}
      value={value}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
    />
  )

  return (
    <div className="onboarding-gate-field">
      <label className="onboarding-gate-field-label" htmlFor={id}>{label}</label>
      <div className="onboarding-gate-password-wrap">
        {input}
        <button
          type="button"
          className="onboarding-gate-password-peek"
          data-ui="onboarding.gate-password-peek"
          data-ui-key={id}
          aria-label={visible ? 'Hide password' : 'Show password'}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  )
}

function UserAvatar({ user, large }: { user: LocalUser; large?: boolean }): JSX.Element {
  return (
    <span
      className={large ? 'onboarding-gate-avatar onboarding-gate-avatar-large' : 'onboarding-gate-avatar'}
      style={{ '--avatar-hue': user.avatarHue } as CSSProperties}
      aria-hidden="true"
    >
      {user.displayName.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function SessionGate({
  users,
  keepSignedIn,
  backdropStatus,
  onKeepSignedInChange,
  onSignIn,
  onSetProfilePassword,
  onCreateAccount
}: SessionGateProps): JSX.Element {
  const [screen, setScreen] = useState<GateScreen>(users.length === 0 ? 'create' : 'users')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [newName, setNewName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const passwordFieldId = useId()
  const confirmFieldId = useId()

  const style = backdropStatus.state === 'ready'
    ? { backgroundImage: `url(${backdropStatus.image})` }
    : undefined

  const selectedUser = selectedUserId
    ? users.find((user) => user.id === selectedUserId) ?? null
    : null
  const needsPasswordSetup = Boolean(selectedUser && !selectedUser.passwordHash)

  const openUser = (userId: string): void => {
    setSelectedUserId(userId)
    setPassword('')
    setConfirmPassword('')
    setError(null)
    setScreen('password')
  }

  const backToUsers = (): void => {
    setScreen('users')
    setSelectedUserId(null)
    setPassword('')
    setConfirmPassword('')
    setError(null)
  }

  const openCreate = (): void => {
    setScreen('create')
    setError(null)
    setNewName('')
    setNewPassword('')
    setNewPasswordConfirm('')
  }

  const submitPassword = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!selectedUser || busy) return
    setError(null)
    if (needsPasswordSetup) {
      if (!password) {
        setError('Choose a password for this profile.')
        return
      }
      if (password.length < 4) {
        setError('Use at least 4 characters.')
        return
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.')
        return
      }
      setBusy(true)
      const result = await onSetProfilePassword(selectedUser.id, password)
      setBusy(false)
      if (!result.ok) {
        setError('Could not set the password. Try again.')
        return
      }
      return
    }
    setBusy(true)
    const result = await onSignIn(selectedUser.id, password)
    setBusy(false)
    if (result.ok) return
    if (result.reason === 'wrong-password') {
      setError('Incorrect password.')
      return
    }
    setError('Could not sign in to this profile.')
  }

  const submitCreate = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    setError(null)
    if (!newName.trim()) {
      setError('Enter a username.')
      return
    }
    if (!newPassword) {
      setError('Enter a password.')
      return
    }
    if (newPassword.length < 4) {
      setError('Use at least 4 characters.')
      return
    }
    if (newPassword !== newPasswordConfirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    const result = await onCreateAccount(newName, newPassword)
    setBusy(false)
    if (result.ok) return
    if (result.reason === 'name-required') setError('Enter a username.')
    else if (result.reason === 'password-required') setError('Enter a password.')
    else if (result.reason === 'password-too-short') setError('Use at least 4 characters.')
    else setError('Could not create the account.')
  }

  return (
    <div className="onboarding-gate" data-ui-surface="onboarding-gate" role="dialog" aria-modal="true" aria-labelledby="onboarding-gate-title">
      <div className={backdropClass(backdropStatus)} style={style} aria-hidden="true" />
      <div className="onboarding-gate-scrim" aria-hidden="true" />

      <div className="onboarding-gate-shell">
        {screen === 'users' && (
          <div className="onboarding-gate-panel">
            <p className="onboarding-gate-eyebrow">ClosedAI</p>
            <h1 id="onboarding-gate-title" className="onboarding-gate-title">Sign in</h1>

            {users.length > 0 ? (
              <ul className="onboarding-gate-users" aria-label="Local profiles">
                {users.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      className="onboarding-gate-user"
                      data-ui="onboarding.gate-sign-in"
                      data-ui-key={user.id}
                      onClick={() => openUser(user.id)}
                    >
                      <UserAvatar user={user} />
                      <span className="onboarding-gate-user-name">{user.displayName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="onboarding-gate-lede">Create a local profile to unlock this workspace.</p>
            )}

            <button
              type="button"
              className="onboarding-gate-not-listed"
              data-ui="onboarding.gate-create-start"
              onClick={openCreate}
            >
              {users.length > 0 ? 'Not listed?' : 'Create account'}
            </button>
          </div>
        )}

        {screen === 'password' && selectedUser && (
          <div className="onboarding-gate-panel onboarding-gate-panel-auth">
            <button
              type="button"
              className="onboarding-gate-back"
              data-ui="onboarding.gate-back"
              onClick={backToUsers}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back
            </button>

            <div className="onboarding-gate-auth-header">
              <UserAvatar user={selectedUser} large />
              <h1 className="onboarding-gate-auth-name">{selectedUser.displayName}</h1>
              <p className="onboarding-gate-auth-hint">
                {needsPasswordSetup
                  ? 'This profile has no password yet. Set one to continue.'
                  : 'Enter your password to unlock this profile.'}
              </p>
            </div>

            <form className="onboarding-gate-auth-form" onSubmit={submitPassword}>
              <PasswordField
                id={passwordFieldId}
                label="Password"
                value={password}
                autoComplete={needsPasswordSetup ? 'new-password' : 'current-password'}
                kind="sign-in"
                autoFocus
                onChange={setPassword}
              />
              {needsPasswordSetup ? (
                <PasswordField
                  id={confirmFieldId}
                  label="Confirm password"
                  value={confirmPassword}
                  autoComplete="new-password"
                  kind="confirm"
                  onChange={setConfirmPassword}
                />
              ) : null}

              {error ? <p className="onboarding-gate-error" role="alert">{error}</p> : null}

              <Button type="submit" className="onboarding-gate-submit" data-ui="onboarding.gate-password-submit" disabled={busy}>
                {needsPasswordSetup ? 'Set password and continue' : 'Sign in'}
              </Button>
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
        )}

        {screen === 'create' && (
          <div className="onboarding-gate-panel onboarding-gate-panel-create">
            {users.length > 0 ? (
              <button
                type="button"
                className="onboarding-gate-back"
                data-ui="onboarding.gate-back"
                onClick={backToUsers}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                Back
              </button>
            ) : null}

            <p className="onboarding-gate-eyebrow">ClosedAI</p>
            <h1 className="onboarding-gate-title">Create account</h1>
            <p className="onboarding-gate-lede">Add a local profile on this machine. Provider accounts connect in the next step.</p>

            <form className="onboarding-gate-create-form" onSubmit={submitCreate}>
              <div className="onboarding-gate-field">
                <label className="onboarding-gate-field-label" htmlFor="onboarding-new-user">Username</label>
                <input
                  id="onboarding-new-user"
                  className="onboarding-gate-input"
                  data-ui="onboarding.gate-display-name"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Username"
                  autoComplete="username"
                  maxLength={64}
                  autoFocus
                />
              </div>

              <PasswordField
                id="onboarding-new-password"
                label="Password"
                value={newPassword}
                autoComplete="new-password"
                kind="new"
                onChange={setNewPassword}
              />

              <PasswordField
                id="onboarding-new-password-confirm"
                label="Confirm password"
                value={newPasswordConfirm}
                autoComplete="new-password"
                kind="confirm"
                onChange={setNewPasswordConfirm}
              />

              {error ? <p className="onboarding-gate-error" role="alert">{error}</p> : null}

              <Button type="submit" variant="secondary" data-ui="onboarding.gate-create" disabled={busy}>
                <UserPlus className="size-4" aria-hidden="true" />
                Create account
              </Button>
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
        )}

        <p className="onboarding-gate-brand" aria-hidden="true">ClosedAI</p>
      </div>
    </div>
  )
}

/** Shown after sign-in while the app relaunches into the account's own workspace. */
export function ProfileSwitchCover({ user, backdropStatus }: { user: LocalUser | null; backdropStatus: BackdropStatus }): JSX.Element {
  const style = backdropStatus.state === 'ready'
    ? { backgroundImage: `url(${backdropStatus.image})` }
    : undefined
  return (
    <div className="onboarding-gate" data-ui-surface="onboarding-profile-switch" role="status" aria-live="polite">
      <div className={backdropClass(backdropStatus)} style={style} aria-hidden="true" />
      <div className="onboarding-gate-scrim" aria-hidden="true" />
      <div className="onboarding-gate-shell">
        <div className="onboarding-gate-auth-header">
          {user ? <UserAvatar user={user} large /> : null}
          <h1 className="onboarding-gate-auth-name">{user?.displayName ?? 'Signing in'}</h1>
          <p className="onboarding-gate-auth-hint">Opening your workspace…</p>
        </div>
      </div>
    </div>
  )
}
