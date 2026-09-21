import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

type StoredTab = { id: string; title: string; url: string }

export async function resolvePokerTab(userData: string, preferred?: string | null): Promise<string | null> {
  if (preferred?.trim()) return preferred.trim()
  try {
    const raw = JSON.parse(await readFile(join(userData, 'browser-tabs.json'), 'utf8')) as { tabs?: StoredTab[] }
    const tabs = raw.tabs ?? []
    const poker = tabs.filter((tab) => /desktoppoker\/index\.htm/i.test(tab.url))
    if (!poker.length) return null
    const table = poker.find((tab) => /#ID=/i.test(tab.url) && /NLHE|Hold'?em|Bomb Pot/i.test(tab.title))
    return (table ?? poker[poker.length - 1])!.id
  } catch {
    return null
  }
}
