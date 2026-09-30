import { ChevronDown, LogOut, Plug } from 'lucide-react'
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

/** Signed-in local profile control in the title bar (visible when menus are dock-only). */
export function SessionAccountMenu({ user, onSignOut, onConnectProviders }: SessionAccountMenuProps): JSX.Element {
  return (
    <div className="titlebar-session-account">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="titlebar-session-account-trigger"
            data-ui="titlebar.session-account"
            data-ui-key={user.id}
            aria-label={`Account menu, signed in as ${user.displayName}`}
          >
            <span
              className="titlebar-session-account-avatar"
              style={{ '--avatar-hue': user.avatarHue } as CSSProperties}
              aria-hidden="true"
            >
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="titlebar-session-account-name">{user.displayName}</span>
            <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="font-normal text-muted-foreground">{user.displayName}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-ui="titlebar.session-connect-providers"
            onSelect={() => onConnectProviders()}
          >
            <Plug className="size-4" aria-hidden="true" />
            Connect providers…
          </DropdownMenuItem>
          <DropdownMenuItem
            data-ui="titlebar.session-sign-out"
            onSelect={() => onSignOut()}
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
