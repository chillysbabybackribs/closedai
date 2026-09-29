// The browser's quick chat floats over the live page. The page is a native view that paints above
// everything the app shell draws, so the quick chat lives in a transparent native layer of its own,
// stacked above the page and sized to its card. The main window's layout decides which chat it is
// and whether it is open; the layer itself decides how the open card shows: the whole chat while the
// user types, and the compact composer with a running feed while a task drives the page.

/** Which chat the quick chat is and whether its card is open (closed shows the floating button). */
export type QuickChatOverlayState = {
  paneId: string | null
  open: boolean
}

/** What the layer renders: the state, plus the page it floats over (CSS pixels) to size the card by. */
export type QuickChatOverlayView = QuickChatOverlayState & {
  page: { width: number; height: number }
  /**
   * Whether the layer holds keyboard focus, as main sees it. A click on the page moves focus to the
   * page's own view without the layer's document ever seeing a blur, so only main can tell.
   */
  focused: boolean
}

/** The layer's content box in CSS pixels, shadow margin included; main anchors it to the page's foot. */
export type QuickChatOverlaySize = { width: number; height: number }

/** Asks the main window's layout to open the quick chat, start a fresh one, or close it to the button. */
export type QuickChatOverlayRequest = 'open' | 'new' | 'close'

export const QUICK_CHAT_OVERLAY_REQUESTS: readonly QuickChatOverlayRequest[] = ['open', 'new', 'close']

/** Query parameter the layer's renderer is loaded with, and its value. */
export const APP_SURFACE_QUERY = 'surface'
export const QUICK_CHAT_SURFACE = 'quick-chat'
