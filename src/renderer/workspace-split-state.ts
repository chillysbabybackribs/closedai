export const CHAT_PANE_MIN_PX = 320
export const WORKSPACE_PANE_MIN_PX = 384
export const CHAT_PANE_STORAGE_KEY = 'closedai.workspace.chatPaneWidth.v1'

const DEFAULT_CHAT_PANE_MAX_PX = 44.2 * 16
const DEFAULT_CHAT_PANE_VIEWPORT_RATIO = 0.48
const MAX_STORED_CHAT_PANE_PX = 4096

type PaneStorage = Pick<Storage, 'getItem' | 'setItem'>

// Mirrors the responsive CSS default that preceded the divider: a useful transcript
// width on compact windows, capped before it can dominate a large desktop.
export function defaultChatPaneWidth(viewportWidth: number): number {
  const safeViewport = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0
  return Math.max(
    CHAT_PANE_MIN_PX,
    Math.min(DEFAULT_CHAT_PANE_MAX_PX, safeViewport * DEFAULT_CHAT_PANE_VIEWPORT_RATIO)
  )
}

export function readChatPaneWidth(storage: Pick<PaneStorage, 'getItem'>): number | null {
  try {
    const width = Number(storage.getItem(CHAT_PANE_STORAGE_KEY))
    if (!Number.isFinite(width) || width < CHAT_PANE_MIN_PX || width > MAX_STORED_CHAT_PANE_PX) {
      return null
    }
    return width
  } catch {
    // Storage can be denied or full without making the workspace unusable.
    return null
  }
}

export function persistChatPaneWidth(storage: Pick<PaneStorage, 'setItem'>, width: number): void {
  if (!Number.isFinite(width)) return
  const safeWidth = Math.round(Math.min(MAX_STORED_CHAT_PANE_PX, Math.max(CHAT_PANE_MIN_PX, width)))
  try {
    storage.setItem(CHAT_PANE_STORAGE_KEY, String(safeWidth))
  } catch {
    // Resizing is the feature; persistence is a best-effort convenience.
  }
}
