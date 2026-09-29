import type { JSX } from 'react'
import type { LayoutPreset } from '../chat-layout/layout-presets.js'

type Cell = 'chat' | 'browser' | 'restore'

/** The arrangements the dock offers; each gathers every open window and tab into its windows. */
const ARRANGEMENTS: Array<{ key: string; label: string; detail: string; preset: LayoutPreset; cells: Cell[] }> = [
  { key: 'browser-side', label: 'Chats left, browser right', detail: 'Every chat tab in one window',
    preset: { kind: 'browser-side' }, cells: ['chat', 'browser'] },
  { key: 'browser-between', label: 'Chat, browser, chat', detail: 'The browser in the middle',
    preset: { kind: 'browser-between' }, cells: ['chat', 'browser', 'chat'] }
]

const itemClass =
  'relative flex w-full cursor-default select-none items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13px] leading-none outline-none hover:bg-[var(--menu-highlight)] focus-visible:bg-[var(--menu-highlight)] disabled:pointer-events-none disabled:text-[var(--menu-quiet)]'

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
 * Layout actions shown inside the dock settings popover: put windows back together, tile floats,
 * or open the workspace layout dialog.
 */
export function DockLayoutSection({ canTile, onTileWindows, onApplyPreset, onOpenLayouts, onClose }: {
  canTile: boolean
  onTileWindows: () => void
  onApplyPreset: (preset: LayoutPreset) => void
  onOpenLayouts: () => void
  onClose: () => void
}): JSX.Element {
  const done = (action: () => void) => () => { action(); onClose() }

  return <div className="flex flex-col gap-0.5" role="group" aria-label="Put windows back together">
    {ARRANGEMENTS.map(({ key, label, detail, preset, cells }) => (
      <button key={key} type="button" className={itemClass} data-ui="dock.layout-item" data-ui-key={key}
        onClick={done(() => onApplyPreset(preset))}>
        <Row cells={cells} label={label} detail={detail} />
      </button>
    ))}
    <button type="button" className={itemClass} data-ui="dock.layout-item" data-ui-key="tile-windows"
      disabled={!canTile} onClick={done(onTileWindows)}>
      <Row cells={['restore', 'restore']} label="Tile windows"
        detail={canTile ? 'Back where they were' : 'Nothing is floating'} />
      <span className="ml-auto pl-4 text-[11px] whitespace-nowrap text-[var(--menu-quiet)]">Ctrl+Shift+L</span>
    </button>
    <div className="-mx-1 my-1 h-px bg-[var(--menu-edge)]" role="separator" />
    <button type="button" className={`${itemClass} pl-12`} data-ui="dock.layout-item" data-ui-key="workspace-layout"
      onClick={done(onOpenLayouts)}>
      Workspace layout…
    </button>
  </div>
}
