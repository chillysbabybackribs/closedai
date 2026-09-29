// The application menu (File, View, Agent, Developer; also the dock launcher) as models reach it:
// `closedai_app.menu {key}` fires the same handler a click on the row fires. The renderer's
// menu model owns labels, shortcuts, and handlers; this list only names the stable row keys, and
// the menu model's test keeps the two identical in both directions.

export const APP_MENU_KEYS = [
  'new-chat', 'search-chats', 'manage-chat-history', 'settings', 'close-tab', 'close-window',
  'toggle-browser-pane', 'notepad', 'overview', 'tile-windows',
  'layout-preset-browser-side', 'layout-preset-browser-between', 'layout-preset-browser-centre',
  'layout-preset-six', 'layout-preset-four', 'workspace-layout',
  'zoom-in', 'zoom-out', 'reset-zoom', 'toggle-full-screen',
  'agents', 'tools', 'compact-context', 'stop-turn',
  'turn-trace', 'saved-sites', 'reload-renderer', 'toggle-devtools'
] as const

export type AppMenuKey = (typeof APP_MENU_KEYS)[number]

/**
 * Rows a model does not run: closing the window or reloading the renderer ends the surface the
 * result would be read from, and DevTools is a developer window outside the app's own UI.
 */
export const MODEL_MENU_EXCLUDED: ReadonlySet<AppMenuKey> = new Set(['close-window', 'reload-renderer', 'toggle-devtools'])

export const MODEL_MENU_KEYS: readonly AppMenuKey[] = APP_MENU_KEYS.filter((key) => !MODEL_MENU_EXCLUDED.has(key))

/** Rows that act on the selected chat; refused while the calling chat is the selected one. */
export const MENU_KEYS_ON_SELECTED_CHAT: ReadonlySet<AppMenuKey> = new Set(['close-tab', 'stop-turn'])

/** CustomEvent the main-process ui host dispatches; the renderer fills `result` synchronously. */
export const APP_MENU_RUN_EVENT = 'closedai:menu-run' as const

export type AppMenuRunResult = {
  key: string
  /** The row's label and the menu it sits in, as the user sees them. */
  label?: string
  menu?: string
  ran: boolean
  /** Not applicable right now, exactly as the menu row would be greyed out. */
  disabled?: boolean
  /** Why the row was not run when it was not disabled. */
  refused?: string
}

export type AppMenuRunDetail = { key: string; callerPaneId: string | null; result?: AppMenuRunResult }
