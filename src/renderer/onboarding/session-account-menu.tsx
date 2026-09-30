import { LogOut, Plug } from 'lucide-react'
import type { CSSProperties, JSX } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../../components/ui/dropdown-menu.js'
import type { LocalUser } from '../../shared/onboarding.js'

export type SessionAccountMenuProps = {
  user: LocalUser
  onSignOut: () => void
  onConnectProviders: () => void
}

function Avatar({ user, className }: { user: LocalUser; className: string }): JSX.Element {
  return (
    <span className={className} style={{ '--avatar-hue': user.avatarHue } as CSSProperties} aria-hidden="true">
      {user.displayName.slice(0, 1).toUpperCase()}
    </span>
  )
}

/**
 * Signed-in local profile: an avatar in the window-control strip, like an OS account button. The
 * name lives in the menu header so the title bar stays as quiet as the window buttons beside it.
 */
export function SessionAccountMenu({ user, onSignOut, onConnectProviders }: SessionAccountMenuProps): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="shell-window-control titlebar-session-account"
          data-ui="titlebar.session-account"
          data-ui-key={user.id}
          title={user.displayName}
          aria-label={`Account menu, signed in as ${user.displayName}`}
        >
          <Avatar user={user} className="titlebar-session-account-avatar" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="titlebar-session-account-menu">
        <DropdownMenuLabel className="titlebar-session-account-header">
          <Avatar user={user} className="titlebar-session-account-avatar titlebar-session-account-avatar-lg" />
          <span className="titlebar-session-account-identity">
            <span className="titlebar-session-account-name">{user.displayName}</span>
            <span className="titlebar-session-account-kind">Signed in on this device</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-ui="titlebar.session-connect-providers" onSelect={() => onConnectProviders()}>
          <Plug className="size-4" aria-hidden="true" />
          Connect providers…
        </DropdownMenuItem>
        <DropdownMenuItem data-ui="titlebar.session-sign-out" onSelect={() => onSignOut()}>
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
