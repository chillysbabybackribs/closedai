import { useState, type CSSProperties, type JSX } from 'react'
import { Eye, EyeOff } from 'lucide-react'

import type { LocalUser } from '../../shared/onboarding.js'

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

export function PasswordField({
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

export function UserAvatar({ user, large }: { user: LocalUser; large?: boolean }): JSX.Element {
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

/** Shown after sign-in while the app relaunches into the account's own workspace. */
export function ProfileSwitchCover({ user }: { user: LocalUser | null }): JSX.Element {
  // A dialog, so the embedded browser's native view yields to the cover like it does to the gate.
  return (
    <div className="onboarding-gate" data-ui-surface="onboarding-profile-switch" role="dialog" aria-modal="true" aria-label="Opening your workspace">
      <div className="onboarding-gate-shell" role="status">
        <div className="onboarding-gate-auth-header">
          {user ? <UserAvatar user={user} large /> : null}
          <h1 className="onboarding-gate-auth-name">{user?.displayName ?? 'Signing in'}</h1>
          <p className="onboarding-gate-auth-hint">Opening your workspace…</p>
        </div>
      </div>
    </div>
  )
}
