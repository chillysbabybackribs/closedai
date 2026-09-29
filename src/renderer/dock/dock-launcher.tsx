import { useRef, type JSX } from 'react'
import { ChevronRight, Grid2X2 } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { DOCK_HEIGHT } from './dock-model.js'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger
} from '../../components/ui/dropdown-menu.js'
import { MENUS, launcherGroups, menuItemDisabled, runMenuItem, type MenuItem, type TitlebarMenuProps } from '../application-menu-model.js'

export function DockLauncher({ open, onOpenChange, menu }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  menu: TitlebarMenuProps
}): JSX.Element {
  const pending = useRef<MenuItem | null>(null)
  const sections = [
    { key: 'home', label: 'Home', rows: launcherGroups('home', '').flatMap(group => group.rows) },
    ...MENUS
  ]

  const execute = (row: MenuItem): void => runMenuItem(row, menu)

  return <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon-sm" data-ui="dock.launcher" aria-label="Open launcher"
        style={{ height: DOCK_HEIGHT }}>
        <Grid2X2 aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" sideOffset={-1}
      className="dock-launcher" aria-label="Application launcher"
      onCloseAutoFocus={(event) => {
        const row = pending.current
        if (!row) return
        event.preventDefault()
        pending.current = null
        // Let the closing menu release focus before an action opens another surface.
        execute(row)
      }}>
      {sections.map(section => <DropdownMenuSub key={section.key}>
        <DropdownMenuSubTrigger data-ui="dock.launcher-section" data-ui-key={section.key}>
          <span>{section.label}</span>
          <ChevronRight className="ml-auto" aria-hidden="true" />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="dock-launcher-submenu" sideOffset={4}>
          {section.rows.map((row, index) => {
            if (row.kind === 'separator') return <DropdownMenuSeparator key={`separator-${index}`} />
            if (row.kind === 'heading') return <DropdownMenuLabel key={`heading-${index}`}>
              {row.label}{section.key === 'agent' ? `: ${menu.selectedChatTitle ?? 'No chat selected'}` : ''}
            </DropdownMenuLabel>
            return <DropdownMenuItem key={row.key}
              data-ui={row.ui?.control ?? 'titlebar.menu-item'} data-ui-key={row.ui?.item ?? row.key}
              disabled={menuItemDisabled(row, menu)}
              onSelect={() => { pending.current = row }}>
              <span>{row.label}</span>
              {row.shortcut && <DropdownMenuShortcut>
                {row.command === 'reset' ? `${menu.chatZoom}%  ` : ''}{row.shortcut}
              </DropdownMenuShortcut>}
            </DropdownMenuItem>
          })}
        </DropdownMenuSubContent>
      </DropdownMenuSub>)}
    </DropdownMenuContent>
  </DropdownMenu>
}
