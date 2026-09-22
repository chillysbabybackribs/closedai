import { memo, useRef, type JSX } from 'react'
import { Menubar } from 'radix-ui'
import {
  CHAT_ZOOM_DEFAULT,
  CHAT_ZOOM_MAX,
  CHAT_ZOOM_MIN,
  type ChatZoomCommand
} from './chat-zoom.js'

/** Everything a menu row can do besides zoom. */
export type MenuAction =
  | 'new-chat' | 'history' | 'settings' | 'close-tab' | 'close-window' | 'search-chats'
  | 'toggle-browser' | 'layout' | 'toggle-fullscreen'
  | 'tools' | 'research' | 'compact' | 'stop-turn'
  | 'trace' | 'reload' | 'devtools'

/** A clickable row, a separator, or a section heading that names what the rows below act on. */
type MenuRow =
  | { kind: 'separator' }
  | { kind: 'heading'; label: string }
  | ({ kind?: 'item'; key: string; label: string; shortcut?: string }
    & ({ command: ChatZoomCommand; action?: never } | { action: MenuAction; command?: never }))

type Menu = { key: string; label: string; rows: MenuRow[] }

const SEP: MenuRow = { kind: 'separator' }

function zoomCommandIsDisabled(command: ChatZoomCommand, chatZoom: number): boolean {
  if (command === 'in') return chatZoom >= CHAT_ZOOM_MAX
  if (command === 'out') return chatZoom <= CHAT_ZOOM_MIN
  return chatZoom === CHAT_ZOOM_DEFAULT
}

/**
 * Row keys are explicit so a relabel never changes a control id that automation depends on.
 * File and View own the shell; Agent owns what the model is given and what the selected chat is
 * doing with it; Developer owns diagnostics of the app itself.
 */
const MENUS: Menu[] = [
  {
    key: 'file',
    label: 'File',
    rows: [
      { key: 'new-chat', label: 'New chat', shortcut: 'Ctrl+N', action: 'new-chat' },
      { key: 'search-chats', label: 'Search chats', shortcut: 'Ctrl+H', action: 'search-chats' },
      { key: 'manage-chat-history', label: 'Manage chat history', action: 'history' },
      SEP,
      { key: 'settings', label: 'Settings', shortcut: 'Ctrl+,', action: 'settings' },
      SEP,
      { key: 'close-tab', label: 'Close tab', shortcut: 'Ctrl+W', action: 'close-tab' },
      { key: 'close-window', label: 'Close window', shortcut: 'Ctrl+Shift+W', action: 'close-window' }
    ]
  },
  {
    key: 'view',
    label: 'View',
    rows: [
      { key: 'toggle-browser-pane', label: 'Toggle browser pane', action: 'toggle-browser' },
      { key: 'workspace-layout', label: 'Workspace layout…', action: 'layout' },
      SEP,
      { key: 'zoom-in', label: 'Zoom in', shortcut: 'Ctrl+=', command: 'in' },
      { key: 'zoom-out', label: 'Zoom out', shortcut: 'Ctrl+-', command: 'out' },
      { key: 'reset-zoom', label: 'Reset zoom', shortcut: 'Ctrl+0', command: 'reset' },
      SEP,
      { key: 'toggle-full-screen', label: 'Toggle full screen', shortcut: 'F11', action: 'toggle-fullscreen' }
    ]
  },
  {
    key: 'agent',
    label: 'Agent',
    rows: [
      { key: 'tools', label: 'Tools & capabilities…', shortcut: 'Ctrl+Shift+T', action: 'tools' },
      { key: 'research-library', label: 'Research library…', action: 'research' },
      SEP,
      { kind: 'heading', label: 'Selected chat' },
      { key: 'compact-context', label: 'Compact context', action: 'compact' },
      { key: 'stop-turn', label: 'Stop turn', shortcut: 'Esc', action: 'stop-turn' }
    ]
  },
  {
    key: 'developer',
    label: 'Developer',
    rows: [
      { key: 'turn-trace', label: 'Turn trace…', shortcut: 'Ctrl+Shift+I', action: 'trace' },
      SEP,
      { key: 'reload-renderer', label: 'Reload renderer', shortcut: 'Ctrl+R', action: 'reload' },
      { key: 'toggle-devtools', label: 'Toggle DevTools', shortcut: 'F12', action: 'devtools' }
    ]
  }
]

export type TitlebarMenuProps = {
  chatZoom: number
  historyOpen: boolean
  /** Title of the selected chat, shown in the Agent menu's section heading. */
  selectedChatTitle: string | null
  /** Rows under "Selected chat" that are not applicable right now are disabled, not hidden. */
  compactEnabled: boolean
  stopEnabled: boolean
  onChatZoomChange: (command: ChatZoomCommand) => void
  onAction: (action: Exclude<MenuAction, 'search-chats'>) => void
  onSearchChats: () => void
}

/** The shell's File / View / Agent / Developer bar, sitting in the title bar's drag region. */
export const TitlebarMenu = memo(function TitlebarMenu({
  chatZoom,
  historyOpen,
  selectedChatTitle,
  compactEnabled,
  stopEnabled,
  onChatZoomChange,
  onAction,
  onSearchChats
}: TitlebarMenuProps): JSX.Element {
  const searchOnClose = useRef(false)
  const disabled = (row: Extract<MenuRow, { key: string }>): boolean => {
    if (row.command) return zoomCommandIsDisabled(row.command, chatZoom)
    if (row.action === 'compact') return !compactEnabled
    if (row.action === 'stop-turn') return !stopEnabled
    return false
  }
  return (
    <Menubar.Root className="titlebar-nav-menu" aria-label="Application menu">
      <div className="titlebar-nav-group">
        {MENUS.map((menu) => (
          <Menubar.Menu key={menu.key}>
            <Menubar.Trigger className="titlebar-nav-tab" data-ui="titlebar.menu" data-ui-key={menu.key}>
              {menu.label}
            </Menubar.Trigger>
            <Menubar.Portal>
              <Menubar.Content className="titlebar-menu-content" align="start" sideOffset={4} loop
                onCloseAutoFocus={event => {
                  if (!searchOnClose.current) return
                  event.preventDefault()
                  searchOnClose.current = false
                  onSearchChats()
                }}>
                {menu.rows.map((row, index) => {
                  if (row.kind === 'separator') {
                    return <Menubar.Separator key={`sep-${index}`} className="titlebar-menu-separator" />
                  }
                  if (row.kind === 'heading') {
                    return (
                      <Menubar.Label key={`heading-${index}`} className="titlebar-menu-heading">
                        {row.label}{selectedChatTitle ? <span className="titlebar-menu-heading-name"> · {selectedChatTitle}</span> : null}
                      </Menubar.Label>
                    )
                  }
                  return (
                    <Menubar.Item
                      key={row.key}
                      className="titlebar-menu-item"
                      data-ui="titlebar.menu-item"
                      data-ui-key={row.key}
                      disabled={disabled(row)}
                      onSelect={() => {
                        if (row.command) {
                          onChatZoomChange(row.command)
                          return
                        }
                        // The search field is focused after the menu's own close-focus, not before it.
                        if (row.action === 'search-chats') searchOnClose.current = true
                        else onAction(row.action)
                      }}
                    >
                      <span>{row.action === 'history' && historyOpen ? 'Close chat history' : row.label}</span>
                      {row.shortcut && (
                        <span className="titlebar-menu-shortcut">
                          {row.command === 'reset' ? `${chatZoom}%  ` : ''}{row.shortcut}
                        </span>
                      )}
                    </Menubar.Item>
                  )
                })}
              </Menubar.Content>
            </Menubar.Portal>
          </Menubar.Menu>
        ))}
      </div>
    </Menubar.Root>
  )
})
