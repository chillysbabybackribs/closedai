import { useState, type JSX } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog.js'
import { BROWSER_PANE_ID, layoutGeometry, type Rect } from './layout-tree.js'
import {
  BROWSER_CENTRE_SLOTS, COMFORTABLE_TILE, chooseGrid, clampGridCount, gridCapacity, presetLayout, presetSlots, singleGroup,
  type CanvasSize, type LayoutPreset
} from './layout-presets.js'

const FALLBACK_CANVAS: CanvasSize = { width: 1280, height: 720 }
const placeholderGroups = (count: number) => Array.from({ length: count }, (_, index) => singleGroup(`slot-${index}`))
const previewTree = (preset: LayoutPreset, size: CanvasSize) => {
  let next = 0
  return presetLayout(preset, placeholderGroups(presetSlots(preset)), size, () => `preview-${next++}`)
}

/** Preset previews are the preset's own tree laid out at the canvas' aspect ratio. */
function PresetWireframe({ preset, size }: { preset: LayoutPreset; size: CanvasSize }): JSX.Element {
  const { panes, minimum } = layoutGeometry(previewTree(preset, size), size.width, size.height)
  // Geometry grows to the tile minimums on a small canvas, exactly as the scrolling workspace does.
  const extent = { width: Math.max(size.width, minimum.width), height: Math.max(size.height, minimum.height) }
  const percent = (rect: Rect) => ({
    left: `${(rect.x / extent.width) * 100}%`, top: `${(rect.y / extent.height) * 100}%`,
    width: `${(rect.width / extent.width) * 100}%`, height: `${(rect.height / extent.height) * 100}%`
  })
  let slot = 0
  return <div className="layout-preset-wire" style={{ aspectRatio: `${extent.width} / ${extent.height}` }} aria-hidden="true">
    {panes.map((pane) => pane.id === BROWSER_PANE_ID
      ? <div key={pane.id} className="layout-preset-wire-browser" style={percent(pane.rect)}><span>Browser</span></div>
      : <div key={pane.id} className="layout-preset-wire-chat" style={percent(pane.rect)}><span>{++slot}</span></div>)}
  </div>
}

function tileHint(size: CanvasSize, preset: LayoutPreset): { text: string; tight: boolean } {
  const grid = preset.kind === 'grid' ? chooseGrid(preset.count, size) : null
  const chat = layoutGeometry(previewTree(preset, size), size.width, size.height).panes.find((pane) => pane.id !== BROWSER_PANE_ID)!.rect
  const shape = grid ? `${grid.cols} × ${grid.rows} · ` : ''
  return { text: `${shape}${Math.round(chat.width)} × ${Math.round(chat.height)} px chats`,
    tight: chat.width < COMFORTABLE_TILE.width || chat.height < COMFORTABLE_TILE.height }
}

function slotNote(slots: number, tileCount: number): string {
  if (tileCount === slots) return `Uses your ${slots} open chat${slots === 1 ? '' : 's'}.`
  if (tileCount > slots) return `Uses your first ${slots} open chats; the other ${tileCount - slots} join the last tile as tabs.`
  const created = slots - tileCount
  return `Uses your ${tileCount} open chat${tileCount === 1 ? '' : 's'} and creates ${created} new one${created === 1 ? '' : 's'}.`
}

type PresetFormProps = { canvas: CanvasSize; tileCount: number; onClose: () => void; onApply: (preset: LayoutPreset) => void }

function LayoutPresetsForm({ canvas, tileCount, onClose, onApply }: PresetFormProps): JSX.Element {
  const capacity = gridCapacity(canvas)
  const [kind, setKind] = useState<LayoutPreset['kind']>('browser-centre')
  const [count, setCount] = useState(() => clampGridCount(Math.max(tileCount, BROWSER_CENTRE_SLOTS), canvas))
  const [draft, setDraft] = useState(() => String(count))
  const gridCount = clampGridCount(count, canvas)
  const preset: LayoutPreset = kind === 'grid' ? { kind, count: gridCount } : { kind }
  const commitCount = (next: number): void => {
    const clamped = clampGridCount(next, canvas)
    setCount(clamped)
    setDraft(String(clamped))
    setKind('grid')
  }
  const centreHint = tileHint(canvas, { kind: 'browser-centre' })
  const gridHint = tileHint(canvas, { kind: 'grid', count: gridCount })
  const apply = (): void => { onApply(preset); onClose() }
  return <div className="layout-preset-form" onKeyDown={(event) => {
    const typing = (event.target as HTMLElement).tagName === 'INPUT'
    if (event.key === 'Enter' && !typing) { event.preventDefault(); apply() }
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !typing) {
      event.preventDefault()
      const next = kind === 'grid' ? 'browser-centre' : 'grid'
      setKind(next)
      ;(event.currentTarget.querySelector(`[data-ui="layout.preset-${next}"]`) as HTMLElement | null)?.focus()
    }
  }}>
    <div className="layout-preset-options" role="radiogroup" aria-label="Layout">
      <div className="layout-preset-card" data-selected={kind === 'browser-centre'}>
        <button type="button" role="radio" aria-checked={kind === 'browser-centre'} className="layout-preset-choice"
          data-ui="layout.preset-browser-centre" onClick={() => setKind('browser-centre')}>
          <span className="layout-preset-title"><span className="layout-preset-radio" aria-hidden="true" />Browser centre</span>
          <PresetWireframe preset={{ kind: 'browser-centre' }} size={canvas} />
          <span className="layout-preset-text">The browser in the middle, two stacked chats on each side.</span>
        </button>
        <div className="layout-preset-row">
          <span className={`layout-preset-hint${centreHint.tight ? ' is-tight' : ''}`}>{centreHint.text}</span>
        </div>
      </div>
      <div className="layout-preset-card" data-selected={kind === 'grid'}>
        <button type="button" role="radio" aria-checked={kind === 'grid'} className="layout-preset-choice"
          data-ui="layout.preset-grid" onClick={() => setKind('grid')}>
          <span className="layout-preset-title"><span className="layout-preset-radio" aria-hidden="true" />Chats only</span>
          <PresetWireframe preset={{ kind: 'grid', count: gridCount }} size={canvas} />
          <span className="layout-preset-text">Chats in a balanced grid for this window. The browser is hidden; the globe button brings it back.</span>
        </button>
        <div className="layout-preset-row">
          <label className="layout-preset-count" htmlFor="layout-preset-count">Chats</label>
          <span className="layout-preset-stepper">
            <button type="button" data-ui="layout.preset-grid-decrement" aria-label="Fewer chats"
              disabled={gridCount <= 1} onClick={() => commitCount(gridCount - 1)}>−</button>
            <input id="layout-preset-count" type="number" inputMode="numeric" min={1} max={capacity} value={draft}
              data-ui="layout.preset-grid-count" onFocus={() => setKind('grid')}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => commitCount(Number(draft))}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitCount(Number(draft)) } }} />
            <button type="button" data-ui="layout.preset-grid-increment" aria-label="More chats"
              disabled={gridCount >= capacity} onClick={() => commitCount(gridCount + 1)}>+</button>
          </span>
          <span className={`layout-preset-hint${gridHint.tight ? ' is-tight' : ''}`}>{gridHint.text} · up to {capacity} on this window</span>
        </div>
      </div>
    </div>
    <div className="layout-preset-footer">
      <span className="layout-preset-note">{slotNote(presetSlots(preset), tileCount)}</span>
      <span className="layout-preset-actions">
        <button type="button" className="layout-preset-btn" data-ui="layout.preset-cancel" onClick={onClose}>Cancel</button>
        <button type="button" className="layout-preset-btn is-primary" data-ui="layout.preset-apply" onClick={apply}>
          Apply layout
        </button>
      </span>
    </div>
  </div>
}

export function LayoutPresetsDialog({ open, size, tileCount, onClose, onApply }: {
  open: boolean
  size: CanvasSize
  /** Visible chat tiles; each keeps its tab group when the preset is applied. */
  tileCount: number
  onClose: () => void
  onApply: (preset: LayoutPreset) => void
}): JSX.Element {
  const canvas = size.width > 0 && size.height > 0 ? size : FALLBACK_CANVAS
  return <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
    <DialogContent className="layout-presets-dialog" data-ui="layout.presets-dialog">
      <div className="layout-preset-heading">
        <DialogTitle>Workspace layout</DialogTitle>
        <span className="layout-preset-canvas">{canvas.width} × {canvas.height} px canvas</span>
      </div>
      <DialogDescription>
        A starting arrangement for this project. It saves like any layout, so drag, resize, split and hide still work afterwards.
      </DialogDescription>
      {open ? <LayoutPresetsForm canvas={canvas} tileCount={tileCount} onClose={onClose} onApply={onApply} /> : null}
    </DialogContent>
  </Dialog>
}
