import { CHAT_ZOOM_DEFAULT, clampChatZoom } from '../chat-zoom.js'

export const CHAT_FONT_SIZE_DEFAULT = 16
export const CHAT_FONT_SIZE_MIN = 13
export const CHAT_FONT_SIZE_MAX = 22
export const APPEARANCE_STORAGE_KEY = 'closedai.appearance.v1'

export type AppearanceSettings = {
  chatFontSize: number
  chatZoom: number
}

type AppearanceStorage = Pick<Storage, 'getItem' | 'setItem'>

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  chatFontSize: CHAT_FONT_SIZE_DEFAULT,
  chatZoom: CHAT_ZOOM_DEFAULT
}

export function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    chatFontSize: clampChatFontSize(record.chatFontSize),
    chatZoom: clampChatZoom(typeof record.chatZoom === 'number' ? record.chatZoom : CHAT_ZOOM_DEFAULT)
  }
}

export function readAppearanceSettings(storage: Pick<AppearanceStorage, 'getItem'>): AppearanceSettings {
  try {
    const raw = storage.getItem(APPEARANCE_STORAGE_KEY)
    return raw ? normalizeAppearanceSettings(JSON.parse(raw)) : { ...DEFAULT_APPEARANCE_SETTINGS }
  } catch {
    return { ...DEFAULT_APPEARANCE_SETTINGS }
  }
}

export function persistAppearanceSettings(
  storage: Pick<AppearanceStorage, 'setItem'>,
  settings: AppearanceSettings
): void {
  try {
    storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(normalizeAppearanceSettings(settings)))
  } catch {
    // Appearance changes should still work when storage is unavailable or full.
  }
}

function clampChatFontSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return CHAT_FONT_SIZE_DEFAULT
  return Math.min(CHAT_FONT_SIZE_MAX, Math.max(CHAT_FONT_SIZE_MIN, Math.round(value)))
}
