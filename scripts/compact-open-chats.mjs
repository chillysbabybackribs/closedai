#!/usr/bin/env node
// Offline shrink of chatOpenIds when the workspace shelf grew far past the runtime cap.
// Records in chats.json are untouched; only app-settings.json open/selection fields change.
//
// Usage (app should be quit so the next launch does not overwrite this):
//   node scripts/compact-open-chats.mjs [--dry-run] [--settings /path/to/app-settings.json]
//
// Keeps: chatSelectedPaneId, pinned chats, then the newest chats with a user message or thread
// until MAX (default 8, matching PeerLifecycle.MAX_ATTACHED_CHATS).

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAX = 8
const DEFAULT_SETTINGS = join(homedir(), '.config', 'closedai', 'app-settings.json')
const DEFAULT_CHATS = join(homedir(), '.config', 'closedai', 'chats.json')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const settingsPath = args.includes('--settings')
  ? args[args.indexOf('--settings') + 1]
  : DEFAULT_SETTINGS
const chatsPath = join(dirname(settingsPath), 'chats.json')

function rank(record) {
  return Math.max(record.updatedAt ?? 0, record.lastTurnEndedAt ?? 0, record.messageSentAt ?? 0)
}

function compact(openIds, selectedId, chatsById) {
  const selected = selectedId && chatsById.get(selectedId) ? selectedId : openIds.find((id) => chatsById.get(id)) ?? null
  const pinned = openIds.filter((id) => chatsById.get(id)?.pinnedAt != null)
  const pool = openIds.filter((id) => id !== selected && !pinned.includes(id))
  const scored = pool
    .map((id) => chatsById.get(id))
    .filter(Boolean)
    .filter((r) => r.messageSentAt != null || r.threadId != null)
    .sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id))
  const kept = new Set([...(selected ? [selected] : []), ...pinned])
  for (const record of scored) {
    if (kept.size >= MAX) break
    kept.add(record.id)
  }
  if (kept.size === 0 && selected) kept.add(selected)
  return [...kept]
}

const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
const chatsFile = JSON.parse(readFileSync(chatsPath, 'utf8'))
const chatsById = new Map((chatsFile.chats ?? []).map((c) => [c.id, c]))
const before = settings.chatOpenIds ?? []
const after = compact(before, settings.chatSelectedPaneId, chatsById)

console.log(`open chats: ${before.length} → ${after.length}${dryRun ? ' (dry run)' : ''}`)
if (before.join() === after.join()) {
  console.log('No change needed.')
  process.exit(0)
}
if (dryRun) {
  console.log('Would keep:', after.join(', '))
  process.exit(0)
}
settings.chatOpenIds = after
if (settings.chatSelectedPaneId && !after.includes(settings.chatSelectedPaneId)) {
  settings.chatSelectedPaneId = after[0] ?? null
}
writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
console.log('Wrote', settingsPath)
console.log('Restart ClosedAI so startup trim matches the saved open list.')
