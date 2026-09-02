export const CHAT_ZOOM_DEFAULT = 100
export const CHAT_ZOOM_MIN = 50
export const CHAT_ZOOM_MAX = 250
export const CHAT_ZOOM_STEP = 10

export type ChatZoomCommand = 'in' | 'out' | 'reset'

export function clampChatZoom(value: number): number {
  if (!Number.isFinite(value)) return CHAT_ZOOM_DEFAULT
  const stepped = Math.round(value / CHAT_ZOOM_STEP) * CHAT_ZOOM_STEP
  return Math.min(CHAT_ZOOM_MAX, Math.max(CHAT_ZOOM_MIN, stepped))
}

export function applyChatZoomCommand(value: number, command: ChatZoomCommand): number {
  if (command === 'reset') return CHAT_ZOOM_DEFAULT
  return clampChatZoom(value + (command === 'in' ? CHAT_ZOOM_STEP : -CHAT_ZOOM_STEP))
}

/** Match the shortcuts shown in View while accepting Cmd on macOS as well as Ctrl. */
export function chatZoomCommandForKey(event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey'>): ChatZoomCommand | null {
  if (event.altKey || (!event.ctrlKey && !event.metaKey)) return null
  if (event.key === '=' || event.key === '+') return 'in'
  if (event.key === '-' || event.key === '_') return 'out'
  if (event.key === '0') return 'reset'
  return null
}
