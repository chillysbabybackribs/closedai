import type { JSX } from 'react'
import {
  Agents16Color, Agents48Color, ArrowSquareDown20Color, ArrowSquareDown32Color, ChatMultiple16Color, ChatMultiple24Color,
  DataLine16Color, DataLine32Color, Globe20Color, Globe24Color, History16Color, History48Color, Star16Color, Star48Color,
  WrenchScrewdriver20Color, WrenchScrewdriver32Color, type FluentIcon
} from '@fluentui/react-icons'
import type { LucideIcon } from 'lucide-react'

/**
 * Every feature's icon, named once. The dock tray and the view tabs read from here, so a new icon
 * set replaces entries in this list and nothing else. A `line` icon takes the surrounding text
 * colour; a `color` icon is Microsoft's Fluent colour set, drawn at the variant nearest its size;
 * a `picture` keeps its own colours and should be an SVG, because the dock magnifies it.
 */
export type AppIcon =
  | { kind: 'line'; glyph: LucideIcon }
  | { kind: 'color'; small: FluentIcon; large: FluentIcon }
  | { kind: 'picture'; src: string }

export type AppIconId = 'chats' | 'browser' | 'agents' | 'saved-sites' | 'downloads' | 'history' | 'tools' | 'trace'

export const APP_ICONS: Record<AppIconId, AppIcon> = {
  chats: { kind: 'color', small: ChatMultiple16Color, large: ChatMultiple24Color },
  browser: { kind: 'color', small: Globe20Color, large: Globe24Color },
  agents: { kind: 'color', small: Agents16Color, large: Agents48Color },
  'saved-sites': { kind: 'color', small: Star16Color, large: Star48Color },
  downloads: { kind: 'color', small: ArrowSquareDown20Color, large: ArrowSquareDown32Color },
  history: { kind: 'color', small: History16Color, large: History48Color },
  tools: { kind: 'color', small: WrenchScrewdriver20Color, large: WrenchScrewdriver32Color },
  trace: { kind: 'color', small: DataLine16Color, large: DataLine32Color }
}

/** Below this many pixels a colour icon uses its small variant, whose detail is drawn for tab size. */
const SMALL_COLOR_ICON = 20

/** A feature's icon at `size` pixels, whichever kind it is. */
export function AppIconMark({ id, size, className }: { id: AppIconId; size: number; className?: string }): JSX.Element {
  const icon = APP_ICONS[id]
  if (icon.kind === 'picture') {
    return <img className={className} src={icon.src} width={size} height={size} alt="" aria-hidden="true" draggable={false} />
  }
  if (icon.kind === 'color') {
    const Glyph = size <= SMALL_COLOR_ICON ? icon.small : icon.large
    // The variant fixes its own width and height attributes, so the size goes on as style.
    return <Glyph className={className} style={{ width: size, height: size }} aria-hidden="true" />
  }
  const Glyph = icon.glyph
  return <Glyph className={className} size={size} aria-hidden="true" />
}
