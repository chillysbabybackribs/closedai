/** CustomEvent name the main-process ui host dispatches to reveal a chat tab in the layout tree. */
export const APP_REVEAL_CHAT_TAB_EVENT = 'closedai:reveal-chat-tab' as const

export type AppRevealChatTabDetail = { paneId: string }

/** CustomEvent name the main-process ui host dispatches to show the browser pane (workspace previews). */
export const APP_REVEAL_BROWSER_EVENT = 'closedai:reveal-browser' as const

/** CustomEvent the main-process ui host dispatches to open a chat the way File → New chat does. */
export const APP_NEW_CHAT_WINDOW_EVENT = 'closedai:new-chat-window' as const

export type AppNewChatWindowDetail = {
  started?: boolean
  settle?: (result: { paneId: string } | Error) => void
}

/** Layout id prefix of view tabs (Tools, Trace, History, Agents, Saved sites); the ui host reports them by it. */
export const VIEW_TAB_PREFIX = 'closedai:view:' as const
