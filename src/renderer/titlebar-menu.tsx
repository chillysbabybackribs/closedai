import { memo, type JSX } from 'react'
import { Menubar } from 'radix-ui'
import {
  CHAT_ZOOM_DEFAULT,
  CHAT_ZOOM_MAX,
  CHAT_ZOOM_MIN,
  type ChatZoomCommand
} from './chat-zoom.js'

/** One menu's worth of rows. `null` is a separator. */
type MenuAction = 'new-chat' | 'history' | 'settings' | 'close-window' | 'toggle-drawer' |
  'toggle-browser' | 'toggle-fullscreen' | 'credentials' | 'tools' | 'trace'

type MenuRow = ({
  label: string
  shortcut?: string
} & ({ command: ChatZoomCommand; action?: never } | { action: MenuAction; command?: never })) | null

type Menu = { label: string; rows: MenuRow[] }

function zoomCommandIsDisabled(command: ChatZoomCommand, chatZoom: number): boolean {
  if (command === 'in') return chatZoom >= CHAT_ZOOM_MAX
  if (command === 'out') return chatZoom <= CHAT_ZOOM_MIN
  return chatZoom === CHAT_ZOOM_DEFAULT
}

const MENUS: Menu[] = [
  {
    label: 'File',
    rows: [
      { label: 'New chat', shortcut: 'Ctrl+N', action: 'new-chat' },
      { label: 'Open chat history', shortcut: 'Ctrl+H', action: 'history' },
      null,
      { label: 'Settings', shortcut: 'Ctrl+,', action: 'settings' },
      null,
      { label: 'Close window', shortcut: 'Ctrl+W', action: 'close-window' }
    ]
  },
  {
    label: 'View',
    rows: [
      { label: 'Toggle side drawer', action: 'toggle-drawer' },
      { label: 'Toggle browser pane', action: 'toggle-browser' },
      null,
      { label: 'Zoom in', shortcut: 'Ctrl+=', command: 'in' },
      { label: 'Zoom out', shortcut: 'Ctrl+-', command: 'out' },
      { label: 'Reset zoom', shortcut: 'Ctrl+0', command: 'reset' },
      null,
      { label: 'Toggle full screen', shortcut: 'F11', action: 'toggle-fullscreen' }
    ]
  },
  {
    label: 'Tools',
    rows: [
      { label: 'Tool configuration', action: 'tools' },
      { label: 'Turn trace', action: 'trace' },
      { label: 'Credential Vault', action: 'credentials' }
    ]
  }
]

export type TitlebarMenuProps = {
  chatZoom: number
  historyOpen: boolean
  drawerCollapsed: boolean
  onChatZoomChange: (command: ChatZoomCommand) => void
  onNewChat: () => void
  onOpenSettings: () => void
  onOpenCredentials: () => void
  onToggleHistory: () => void
  onToggleDrawer: () => void
  onToggleBrowser: () => void
  onToggleFullscreen: () => void
  onCloseWindow: () => void
  /** Tools and turn trace dialogs belong to the selected chat pane. */
  onOpenPaneDialog: (dialog: 'tools' | 'trace') => void
}

/** The shell's File / View / Tools bar, sitting in the title bar's drag region. */
export const TitlebarMenu = memo(function TitlebarMenu({
  chatZoom,
  historyOpen,
  drawerCollapsed,
  onChatZoomChange,
  onNewChat,
  onOpenSettings,
  onOpenCredentials,
  onToggleHistory,
  onToggleDrawer,
  onToggleBrowser,
  onToggleFullscreen,
  onCloseWindow,
  onOpenPaneDialog
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
                      disabled={row.command ? zoomCommandIsDisabled(row.command, chatZoom) : false}
                      onSelect={() => {
                        if (row.command) {
                          onChatZoomChange(row.command)
                          return
                        }
                        if (row.action === 'new-chat') onNewChat()
                        if (row.action === 'settings') onOpenSettings()
                        if (row.action === 'credentials') onOpenCredentials()
                        if (row.action === 'history') onToggleHistory()
                        if (row.action === 'toggle-drawer') onToggleDrawer()
                        if (row.action === 'toggle-browser') onToggleBrowser()
                        if (row.action === 'toggle-fullscreen') onToggleFullscreen()
                        if (row.action === 'close-window') onCloseWindow()
                        if (row.action === 'tools' || row.action === 'trace') onOpenPaneDialog(row.action)
                      }}
                    >
                      <span>{
                        row.action === 'history' && historyOpen ? 'Close chat history'
                          : row.action === 'toggle-drawer' ? `${drawerCollapsed ? 'Show' : 'Hide'} side drawer`
                            : row.label
                      }</span>
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
