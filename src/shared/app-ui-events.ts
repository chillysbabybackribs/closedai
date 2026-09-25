/** CustomEvent name the main-process ui host dispatches to reveal a chat tab in the layout tree. */
export const APP_REVEAL_CHAT_TAB_EVENT = 'closedai:reveal-chat-tab' as const

export type AppRevealChatTabDetail = { paneId: string }

/** CustomEvent name the main-process ui host dispatches to show the browser pane (workspace previews). */
export const APP_REVEAL_BROWSER_EVENT = 'closedai:reveal-browser' as const
