import type { JSX } from 'react'
import { LayoutPanelLeft } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger
} from '../../components/ui/dropdown-menu.js'
import type { LayoutPreset } from '../chat-layout/layout-presets.js'

type Cell = 'chat' | 'browser' | 'restore'

/** The arrangements the dock offers; each gathers every open window and tab into its windows. */
const ARRANGEMENTS: Array<{ key: string; label: string; detail: string; preset: LayoutPreset; cells: Cell[] }> = [
  { key: 'browser-side', label: 'Chats left, browser right', detail: 'Every chat tab in one window',
    preset: { kind: 'browser-side' }, cells: ['chat', 'browser'] },
  { key: 'browser-between', label: 'Chat, browser, chat', detail: 'The browser in the middle',
    preset: { kind: 'browser-between' }, cells: ['chat', 'browser', 'chat'] }
]

/** A small plan of the arrangement: chats outlined, the browser filled. */
function LayoutGlyph({ cells }: { cells: Cell[] }): JSX.Element {
  return <span aria-hidden="true" className="flex h-[18px] w-[30px] shrink-0 gap-[2px]">
    {cells.map((cell, index) => <span key={index} className={cell === 'browser'
      ? 'flex-[1.3] rounded-[2px] bg-[var(--menu-glyph)] opacity-70'
      : cell === 'restore' ? 'flex-1 rounded-[2px] border border-dashed border-[var(--menu-glyph)]'
        : 'flex-1 rounded-[2px] border border-[var(--menu-glyph)]'} />)}
  </span>
}

function Row({ cells, label, detail }: { cells: Cell[]; label: string; detail: string }): JSX.Element {
  return <>
    <LayoutGlyph cells={cells} />
    <span className="flex min-w-0 flex-col gap-1">
      <span>{label}</span>
      <span className="text-[11px] text-[var(--menu-quiet)]">{detail}</span>
    </span>
  </>
}

/**
 * The dock's Layout menu: always clickable, so there is one obvious place to put windows back
 * together. Tile windows returns floating windows to the last tiled layout; the arrangements
 * rebuild the layout from every window and tab, floating and minimized ones included.
 */
export function DockLayoutMenu({ open, onOpenChange, canTile, onTileWindows, onApplyPreset, onOpenLayouts }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  canTile: boolean
  onTileWindows: () => void
  onApplyPreset: (preset: LayoutPreset) => void
  onOpenLayouts: () => void
}): JSX.Element {
  return <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm" data-ui="dock.layout" aria-pressed={open}>
        <LayoutPanelLeft aria-hidden="true" />Layout
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="end" sideOffset={10} className="w-72"
      onCloseAutoFocus={(event) => event.preventDefault()}>
      <DropdownMenuLabel>Put windows back together</DropdownMenuLabel>
      {ARRANGEMENTS.map(({ key, label, detail, preset, cells }) => (
        <DropdownMenuItem key={key} data-ui="dock.layout-item" data-ui-key={key} className="h-auto py-2"
          onSelect={() => onApplyPreset(preset)}>
          <Row cells={cells} label={label} detail={detail} />
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem data-ui="dock.layout-item" data-ui-key="tile-windows" className="h-auto py-2"
        disabled={!canTile} onSelect={onTileWindows}>
        <Row cells={['restore', 'restore']} label="Tile windows"
          detail={canTile ? 'Floating windows back where they were' : 'Nothing is floating'} />
        <DropdownMenuShortcut>Ctrl+Shift+L</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem data-ui="dock.layout-item" data-ui-key="workspace-layout" className="pl-12" onSelect={onOpenLayouts}>
        Workspace layout…
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}
