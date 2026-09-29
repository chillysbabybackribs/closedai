import {
  CHAT_ZOOM_DEFAULT,
  CHAT_ZOOM_MAX,
  CHAT_ZOOM_MIN,
  type ChatZoomCommand
} from './chat-zoom.js'
import { QUICK_LAYOUT_PRESETS, type LayoutPreset } from './chat-layout/layout-presets.js'
import { MENU_KEYS_ON_SELECTED_CHAT, type AppMenuKey, type AppMenuRunResult } from '../shared/app-menu-run.js'

/** Everything a menu row can do besides zoom. */
export type MenuAction =
  | 'new-chat' | 'history' | 'settings' | 'close-tab' | 'close-window' | 'search-chats'
  | 'toggle-browser' | 'saved-sites' | 'layout' | 'toggle-fullscreen'
  | 'agents' | 'tools' | 'compact' | 'stop-turn'
  | 'trace' | 'reload' | 'devtools' | 'overview' | 'tile-windows'

type MenuControlUi = { control: 'layout.dock-preset' | 'layout.preset-menu-custom'; item?: string }

/** A clickable row, a separator, or a section heading that names what the rows below act on. */
export type MenuRow =
  | { kind: 'separator' }
  | { kind: 'heading'; label: string }
  | ({ kind?: 'item'; key: AppMenuKey; label: string; shortcut?: string; ui?: MenuControlUi }
    & ({ command: ChatZoomCommand; action?: never; layoutPreset?: never }
      | { action: MenuAction; command?: never; layoutPreset?: never }
      | { layoutPreset: LayoutPreset; action?: never; command?: never }))

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
const VIEW_LAYOUT_ROWS: MenuRow[] = [
  ...QUICK_LAYOUT_PRESETS.map(({ key, label, preset }) => ({
    key: `layout-preset-${key}` as AppMenuKey,
    label,
    layoutPreset: preset,
    ui: { control: 'layout.dock-preset' as const, item: key }
  })),
  { key: 'workspace-layout', label: 'Workspace layout…', action: 'layout' as const,
    ui: { control: 'layout.preset-menu-custom' as const } }
]

export const MENUS: Menu[] = [
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
      { key: 'overview', label: 'Workspace overview', shortcut: 'Ctrl+Shift+O', action: 'overview' },
      { key: 'tile-windows', label: 'Tile windows', shortcut: 'Ctrl+Shift+L', action: 'tile-windows' },
      SEP,
      ...VIEW_LAYOUT_ROWS,
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
      { key: 'agents', label: 'Agents…', action: 'agents' },
      { key: 'tools', label: 'Tools & capabilities…', shortcut: 'Ctrl+Shift+T', action: 'tools' },
      SEP,
      { kind: 'heading', label: 'Selected chat' },
      { key: 'compact-context', label: 'Shrink provider context', action: 'compact' },
      { key: 'stop-turn', label: 'Stop turn', shortcut: 'Esc', action: 'stop-turn' }
    ]
  },
  {
    key: 'developer',
    label: 'Developer',
    rows: [
      { key: 'turn-trace', label: 'Turn trace…', shortcut: 'Ctrl+Shift+I', action: 'trace' },
      { key: 'saved-sites', label: 'Saved sites…', action: 'saved-sites' },
      SEP,
      { key: 'reload-renderer', label: 'Reload renderer', shortcut: 'Ctrl+R', action: 'reload' },
      { key: 'toggle-devtools', label: 'Toggle DevTools', shortcut: 'F12', action: 'devtools' }
    ]
  }
]

export type TitlebarMenuProps = {
  chatZoom: number
  /** Title of the selected chat, shown in the Agent menu's section heading. */
  selectedChatTitle: string | null
  /** Rows under "Selected chat" that are not applicable right now are disabled, not hidden. */
  compactEnabled: boolean
  stopEnabled: boolean
  onChatZoomChange: (command: ChatZoomCommand) => void
  onAction: (action: Exclude<MenuAction, 'search-chats'>) => void
  onSearchChats: () => void
  layoutEnabled: boolean
  /** Some window floats, so Tile windows has something to put back. */
  tileEnabled: boolean
  onApplyLayoutPreset: (preset: LayoutPreset) => void
}


export type MenuItem = Extract<MenuRow, { key: string }>

export function menuItemDisabled(row: MenuItem, state: Pick<TitlebarMenuProps,
  'chatZoom' | 'tileEnabled' | 'layoutEnabled' | 'compactEnabled' | 'stopEnabled'>): boolean {
  if (row.command) return zoomCommandIsDisabled(row.command, state.chatZoom)
  if (row.action === 'tile-windows') return !state.tileEnabled
  if (row.layoutPreset || row.action === 'toggle-browser' || row.action === 'layout' || row.action === 'overview') return !state.layoutEnabled
  if (row.action === 'compact') return !state.compactEnabled
  if (row.action === 'stop-turn') return !state.stopEnabled
  return false
}

/** What choosing a row does; the title bar menu, the dock launcher, and model runs share it. */
export function runMenuItem(row: MenuItem, menu: Pick<TitlebarMenuProps,
  'onChatZoomChange' | 'onApplyLayoutPreset' | 'onSearchChats' | 'onAction'>): void {
  if (row.command) menu.onChatZoomChange(row.command)
  else if (row.layoutPreset) menu.onApplyLayoutPreset(row.layoutPreset)
  else if (row.action === 'search-chats') menu.onSearchChats()
  else menu.onAction(row.action)
}

/**
 * A model's `closedai_app.menu`: the row by key, refused when it is disabled exactly as the
 * menu greys it out, and refused for rows that act on the selected chat while that is the caller.
 */
export function runMenuKey(key: string, menu: TitlebarMenuProps,
  chat: { selectedPaneId: string | null; callerPaneId: string | null }): AppMenuRunResult {
  const owner = MENUS.find(candidate => candidate.rows.some(row => 'key' in row && row.key === key))
  const row = owner?.rows.find((candidate): candidate is MenuItem => 'key' in candidate && candidate.key === key)
  if (!owner || !row) return { key, ran: false, refused: `No menu row has the key ${key}` }
  const found = { key, label: row.label, menu: owner.label }
  if (menuItemDisabled(row, menu)) return { ...found, ran: false, disabled: true }
  if (MENU_KEYS_ON_SELECTED_CHAT.has(row.key) && chat.callerPaneId && chat.selectedPaneId === chat.callerPaneId) {
    return { ...found, ran: false, refused: `${row.label} acts on the selected chat, which is the calling chat; select another pane with command open_chat first` }
  }
  runMenuItem(row, menu)
  return { ...found, ran: true }
}

export const HOME_ACTIONS = new Set(['new-chat', 'search-chats', 'toggle-browser-pane', 'agents', 'tools', 'settings'])

export function launcherGroups(section: string, query: string): Menu[] {
  const search = query.trim().toLocaleLowerCase()
  return MENUS.map(menu => ({ ...menu, rows: menu.rows.filter(row => {
    if (!('key' in row)) return false
    if (search) return `${menu.label} ${row.label} ${row.shortcut ?? ''}`.toLocaleLowerCase().includes(search)
    return section === 'home' ? HOME_ACTIONS.has(row.key) : section === menu.key
  }) })).filter(menu => menu.rows.length > 0)
}
