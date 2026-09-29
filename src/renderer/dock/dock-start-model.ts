import type { AppMenuKey } from '../../shared/app-menu-run.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { launcherGroups, MENUS, type MenuItem } from '../application-menu-model.js'
import type { AppIconId } from '../app-icons.js'

/** Pinned Start tiles in display order; keys match application menu rows. */
export const START_PIN_KEYS = [
  'new-chat',
  'search-chats',
  'manage-chat-history',
  'toggle-browser-pane',
  'agents',
  'tools',
  'settings'
] as const satisfies readonly AppMenuKey[]

export type StartPinKey = (typeof START_PIN_KEYS)[number]

export type StartPinVisual = { kind: 'app'; id: AppIconId } | { kind: 'glyph'; id: 'new-chat' | 'search' | 'settings' }

const PIN_VISUAL: Record<StartPinKey, StartPinVisual> = {
  'new-chat': { kind: 'glyph', id: 'new-chat' },
  'search-chats': { kind: 'glyph', id: 'search' },
  'manage-chat-history': { kind: 'app', id: 'chats' },
  'toggle-browser-pane': { kind: 'app', id: 'browser' },
  agents: { kind: 'app', id: 'agents' },
  tools: { kind: 'app', id: 'tools' },
  settings: { kind: 'glyph', id: 'settings' }
}

export function startPinVisual(key: StartPinKey): StartPinVisual {
  return PIN_VISUAL[key]
}

export function menuItemByKey(key: string): MenuItem | undefined {
  for (const menu of MENUS) {
    const row = menu.rows.find((candidate): candidate is MenuItem => 'key' in candidate && candidate.key === key)
    if (row) return row
  }
  return undefined
}

/** Menu rows pinned on the Start grid, omitting keys that are not in the menu model. */
export function startPins(): MenuItem[] {
  return START_PIN_KEYS.map((key) => menuItemByKey(key)).filter((row): row is MenuItem => row !== undefined)
}

export type StartSearchHit = { menu: string; row: MenuItem }

/** Flat search hits across File, View, Agent, and Developer when `query` is non-empty. */
export function searchStartMenu(query: string): StartSearchHit[] {
  const trimmed = query.trim()
  if (!trimmed) return []
  return launcherGroups('', trimmed).flatMap((group) =>
    group.rows.filter((row): row is MenuItem => 'key' in row).map((row) => ({ menu: group.label, row }))
  )
}

/** All actionable menu rows grouped for the Start "All apps" list. */
export function allStartMenuGroups(): Array<{ menu: string; rows: MenuItem[] }> {
  return MENUS.map((group) => ({
    menu: group.label,
    rows: group.rows.filter((row): row is MenuItem => 'key' in row)
  }))
}

const RECENT_LIMIT = 6

/** Newest chats for the Recommended section (any project). */
export function recentChatsForStart(chats: readonly ChatRowSummary[], limit = RECENT_LIMIT): ChatRowSummary[] {
  return [...chats].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, limit)
}
