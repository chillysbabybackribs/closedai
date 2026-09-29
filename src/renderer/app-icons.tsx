import type { JSX } from 'react'
import { Activity, Download, Globe2, History, MessagesSquare, NotebookPen, Star, Workflow, Wrench, type LucideIcon } from 'lucide-react'

/**
 * Every feature's icon, named once. The dock tray and the view tabs read from here, so a new icon
 * set replaces entries in this list and nothing else. A `line` icon takes the surrounding text
 * colour; a `picture` keeps its own colours and should be an SVG, because the dock magnifies it.
 */
export type AppIcon = { kind: 'line'; glyph: LucideIcon } | { kind: 'picture'; src: string }

export type AppIconId = 'chats' | 'browser' | 'agents' | 'saved-sites' | 'downloads' | 'history' | 'tools' | 'trace' | 'note'

export const APP_ICONS: Record<AppIconId, AppIcon> = {
  chats: { kind: 'line', glyph: MessagesSquare },
  browser: { kind: 'line', glyph: Globe2 },
  agents: { kind: 'line', glyph: Workflow },
  'saved-sites': { kind: 'line', glyph: Star },
  downloads: { kind: 'line', glyph: Download },
  history: { kind: 'line', glyph: History },
  tools: { kind: 'line', glyph: Wrench },
  trace: { kind: 'line', glyph: Activity },
  note: { kind: 'line', glyph: NotebookPen }
}

/** A feature's icon at `size` pixels, whichever kind it is. */
export function AppIconMark({ id, size, className }: { id: AppIconId; size: number; className?: string }): JSX.Element {
  const icon = APP_ICONS[id]
  if (icon.kind === 'picture') {
    return <img className={className} src={icon.src} width={size} height={size} alt="" aria-hidden="true" draggable={false} />
  }
  const Glyph = icon.glyph
  return <Glyph className={className} size={size} aria-hidden="true" />
}
