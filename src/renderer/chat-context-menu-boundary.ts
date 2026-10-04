/** Inset from the chat tile edge when flipping or shifting a context menu. */
export const CHAT_CONTEXT_MENU_COLLISION_PADDING = 12

/** The box a chat window menu must stay inside: the tile card, not the whole app window. */
export function chatContextMenuCollisionBoundary(trigger: Element | null): Element | null {
  return trigger?.closest('.chat-layout-tile') ?? trigger?.closest('.chat-pane') ?? null
}
