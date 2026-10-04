import type { JSX } from 'react'
import type { IconComponent } from './icons/index.js'
import { FileVideo } from './icons/index.js'
import {
  AskGlyph, HistoryGlyph, NewChatGlyph, SearchGlyph, StartGlyph,
  TraceGlyph, type GlyphComponent
} from './icons/glyphs.js'

/**
 * Every feature's icon, named once. The dock tray and the view tabs read from here, so a new icon
 * set replaces entries in this list and nothing else. A `glyph` is a hand-built duotone SVG from
 * `icons/glyphs.tsx`; a `line` icon is a Framework7 glyph from `icons/index.tsx`. Both take the surrounding text colour. A
 * `picture` keeps its own colours: use SVG or a raster asset large enough for dock magnification.
 */
export type AppIcon = { kind: 'line'; glyph: IconComponent } | { kind: 'glyph'; Glyph: GlyphComponent } | { kind: 'picture'; src: string }

export type AppIconId =
  | 'files' | 'file' | 'chats' | 'browser' | 'video' | 'agents' | 'saved-sites' | 'downloads' | 'history' | 'tools' | 'trace' | 'note'
  | 'new-chat' | 'search' | 'settings' | 'workspaces' | 'ask' | 'start' | 'library'

export const APP_ICONS: Record<AppIconId, AppIcon> = {
  files: { kind: 'picture', src: new URL('./icons/files.svg', import.meta.url).href },
  file: { kind: 'picture', src: new URL('./icons/files.svg', import.meta.url).href },
  chats: { kind: 'picture', src: new URL('./icons/chats.svg', import.meta.url).href },
  browser: { kind: 'picture', src: new URL('./icons/browser.svg', import.meta.url).href },
  video: { kind: 'line', glyph: FileVideo },
  agents: { kind: 'picture', src: new URL('./icons/agents.webp', import.meta.url).href },
  'saved-sites': { kind: 'picture', src: new URL('./icons/saved.webp', import.meta.url).href },
  downloads: { kind: 'picture', src: new URL('./icons/downloads.webp', import.meta.url).href },
  history: { kind: 'glyph', Glyph: HistoryGlyph },
  tools: { kind: 'picture', src: new URL('./icons/tools.webp', import.meta.url).href },
  trace: { kind: 'glyph', Glyph: TraceGlyph },
  note: { kind: 'picture', src: new URL('./icons/notes.svg', import.meta.url).href },
  library: { kind: 'picture', src: new URL('./icons/library.webp', import.meta.url).href },
  'new-chat': { kind: 'glyph', Glyph: NewChatGlyph },
  search: { kind: 'glyph', Glyph: SearchGlyph },
  settings: { kind: 'picture', src: new URL('./icons/settings.webp', import.meta.url).href },
  workspaces: { kind: 'picture', src: new URL('./icons/workspaces.webp', import.meta.url).href },
  ask: { kind: 'glyph', Glyph: AskGlyph },
  start: { kind: 'glyph', Glyph: StartGlyph }
}

/** A feature's icon at `size` pixels, whichever kind it is. */
export function AppIconMark({ id, size, className }: { id: AppIconId; size: number; className?: string }): JSX.Element {
  const icon = APP_ICONS[id]
  if (icon.kind === 'picture') {
    return <img className={className} src={icon.src} width={size} height={size} alt="" aria-hidden="true" draggable={false} />
  }
  if (icon.kind === 'glyph') {
    const Glyph = icon.Glyph
    return <Glyph className={className} size={size} />
  }
  const Glyph = icon.glyph
  return <Glyph className={className} size={size} aria-hidden="true" />
}
