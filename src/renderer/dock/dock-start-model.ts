import type { AppMenuKey } from '../../shared/app-menu-run.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { basename } from '../chat-history/history-format.js'
import { listableChat, sortByActivity, type ChatActivityHit } from '../chat-history/history-search.js'
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

/** Screens Start shows in its own body instead of handing off to the header, a view tab, or a dialog. */
export type StartView = 'home' | 'search-chats' | 'history' | 'agents' | 'tools' | 'settings'
export type StartScreen = Exclude<StartView, 'home'>

const SCREEN_FOR_ACTION: Partial<Record<string, StartScreen>> = {
  'search-chats': 'search-chats',
  history: 'history',
  agents: 'agents',
  tools: 'tools',
  settings: 'settings'
}

export const START_SCREEN_TITLES: Record<StartScreen, string> = {
  'search-chats': 'Search chats',
  history: 'Chat history',
  agents: 'Agents',
  tools: 'Tools & capabilities',
  settings: 'Settings'
}

/**
 * The Start screen a menu row opens when chosen from Start (pins, All apps, command search), or
 * null for rows that just run. The same rows from the title-bar menus and shortcuts are unchanged.
 */
export function startScreenForRow(row: MenuItem): StartScreen | null {
  return row.action ? SCREEN_FOR_ACTION[row.action] ?? null : null
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

function startChatStatus(row: ChatRowSummary): ChatActivityHit['status'] {
  if (row.running) return 'running'
  if (row.paused) return 'paused'
  return row.attached ? 'open' : 'closed'
}

/**
 * Last-used listable chats for Start, newest activity first. Omits blank detached tabs the same
 * way as header search and History; returns nothing when there is nothing worth listing.
 */
export function recentChatsForStart(chats: readonly ChatRowSummary[], limit = RECENT_LIMIT): ChatActivityHit[] {
  return sortByActivity(chats.filter(listableChat))
    .slice(0, Math.max(0, limit))
    .map((row) => ({
      row,
      titleRanges: [],
      folder: basename(row.cwd),
      score: 0,
      status: startChatStatus(row),
      completedAt: null
    }))
}
