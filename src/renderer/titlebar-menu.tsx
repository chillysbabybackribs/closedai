import { memo, type JSX } from 'react'
import { Menubar } from 'radix-ui'
import {
  CHAT_ZOOM_DEFAULT,
  CHAT_ZOOM_MAX,
  CHAT_ZOOM_MIN,
  type ChatZoomCommand
} from './chat-zoom.js'

/** One menu's worth of rows. `null` is a separator. */
type MenuRow = {
  label: string
  shortcut?: string
  command?: ChatZoomCommand
  action?: 'settings' | 'history'
} | null

type Menu = { label: string; rows: MenuRow[] }

function zoomCommandIsDisabled(command: ChatZoomCommand, chatZoom: number): boolean {
  if (command === 'in') return chatZoom >= CHAT_ZOOM_MAX
  if (command === 'out') return chatZoom <= CHAT_ZOOM_MIN
  return chatZoom === CHAT_ZOOM_DEFAULT
}

/* Shell menus matching the desktop apps this chrome is modelled on. Rows without
   commands remain placeholders until their application behavior exists. */
const MENUS: Menu[] = [
  {
    label: 'File',
    rows: [
      { label: 'New chat', shortcut: 'Ctrl+N' },
      { label: 'Open chat history', shortcut: 'Ctrl+H', action: 'history' },
      null,
      { label: 'Settings', shortcut: 'Ctrl+,', action: 'settings' },
      null,
      { label: 'Close window', shortcut: 'Ctrl+W' }
    ]
  },
  {
    label: 'Edit',
    rows: [
      { label: 'Undo', shortcut: 'Ctrl+Z' },
      { label: 'Redo', shortcut: 'Ctrl+Shift+Z' },
      null,
      { label: 'Cut', shortcut: 'Ctrl+X' },
      { label: 'Copy', shortcut: 'Ctrl+C' },
      { label: 'Paste', shortcut: 'Ctrl+V' },
      null,
      { label: 'Find in chat', shortcut: 'Ctrl+F' }
    ]
  },
  {
    label: 'View',
    rows: [
      { label: 'Reload', shortcut: 'Ctrl+R' },
      { label: 'Toggle browser pane' },
      null,
      { label: 'Zoom in', shortcut: 'Ctrl+=', command: 'in' },
      { label: 'Zoom out', shortcut: 'Ctrl+-', command: 'out' },
      { label: 'Actual size', shortcut: 'Ctrl+0', command: 'reset' },
      null,
      { label: 'Full screen', shortcut: 'F11' }
    ]
  },
  {
    label: 'Help',
    rows: [
      { label: 'Documentation' },
      { label: 'Keyboard shortcuts' },
      null,
      { label: 'About ClosedAI' }
    ]
  }
]

export type TitlebarMenuProps = {
  chatZoom: number
  historyOpen: boolean
  onChatZoomChange: (command: ChatZoomCommand) => void
  onOpenSettings: () => void
  onToggleHistory: () => void
}

/** The shell's File / Edit / View / Help bar, sitting in the title bar's drag region. */
export const TitlebarMenu = memo(function TitlebarMenu({
  chatZoom,
  historyOpen,
  onChatZoomChange,
  onOpenSettings,
  onToggleHistory
}: TitlebarMenuProps): JSX.Element {
  return (
    <Menubar.Root className="titlebar-nav-menu" aria-label="Application menu">
      <div className="titlebar-nav-group">
        {MENUS.map((menu) => (
          <Menubar.Menu key={menu.label}>
            <Menubar.Trigger className="titlebar-nav-tab" data-ui="titlebar.menu" data-ui-key={menu.label.toLowerCase()}>
              {menu.label}
            </Menubar.Trigger>
            <Menubar.Portal>
              <Menubar.Content className="titlebar-menu-content" align="start" sideOffset={4} loop>
                {menu.rows.map((row, index) =>
                  row === null ? (
                    <Menubar.Separator key={`sep-${index}`} className="titlebar-menu-separator" />
                  ) : (
                    <Menubar.Item
                      key={row.label}
                      className="titlebar-menu-item"
                      data-ui="titlebar.menu-item"
                      data-ui-key={row.label.toLowerCase().replace(/\s+/g, '-')}
                      disabled={
                        (!row.command && !row.action) ||
                        (row.command ? zoomCommandIsDisabled(row.command, chatZoom) : false)
                      }
                      onSelect={() => {
                        if (row.command) onChatZoomChange(row.command)
                        if (row.action === 'settings') onOpenSettings()
                        if (row.action === 'history') onToggleHistory()
                      }}
                    >
                      {/* The row keeps its manifest key; only the wording follows the panel. */}
                      <span>{row.action === 'history' && historyOpen ? 'Close chat history' : row.label}</span>
                      {row.shortcut && (
                        <span className="titlebar-menu-shortcut">
                          {row.command === 'reset' ? `${chatZoom}%  ` : ''}{row.shortcut}
                        </span>
                      )}
                    </Menubar.Item>
                  )
                )}
              </Menubar.Content>
            </Menubar.Portal>
          </Menubar.Menu>
        ))}
      </div>
    </Menubar.Root>
  )
})
