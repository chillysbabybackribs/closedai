// The browser's quick chat floats over the live page. The page is a native view that paints above
// everything the app shell draws, so the quick chat lives in a transparent native layer of its own,
// stacked above the page and sized to its card. The main window's layout decides which chat it is
// and whether it is open; the layer itself decides how the open card shows: the whole chat, or the
// compact composer with a one-line status. Only the user's shrink and expand buttons change it;
// sending a message and clicks on the page never do.

/** Which chat the quick chat is and whether its card is open (closed shows the floating button). */
export type QuickChatOverlayState = {
  paneId: string | null
  open: boolean
}

/** What the layer renders: the state, plus the page it floats over (CSS pixels) to size the card by. */
export type QuickChatOverlayView = QuickChatOverlayState & {
  page: { width: number; height: number }
  /** The site the browser shows ("espn.com"), for "Working on espn.com"; null for a non-web page. */
  site: string | null
}

/** The layer's content box in CSS pixels, shadow margin included; main anchors it to the page's foot. */
export type QuickChatOverlaySize = { width: number; height: number }

/**
 * Asks the main window's layout to open the quick chat, start a fresh one, close it to the button,
 * or toggle between open and closed (Ctrl+J).
 */
export type QuickChatOverlayRequest = 'open' | 'new' | 'close' | 'toggle'

export const QUICK_CHAT_OVERLAY_REQUESTS: readonly QuickChatOverlayRequest[] = ['open', 'new', 'close', 'toggle']

/** The browser quick chat or a notepad window's chat; stored on the chat record for history rows. */
export type QuickChatSurface = 'browser' | 'notepad'

/** Query parameter the layer's renderer is loaded with, and its value. */
export const APP_SURFACE_QUERY = 'surface'
export const QUICK_CHAT_SURFACE = 'quick-chat'
