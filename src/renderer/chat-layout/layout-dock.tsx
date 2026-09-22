import { type JSX } from 'react'
import { PresetWireframe } from './layout-presets-dialog.js'
import type { CanvasSize, LayoutPreset } from './layout-presets.js'

// Wireframes are previews, not the live canvas: a fixed aspect keeps the four icons
// consistent regardless of the window's actual shape at the moment of hover.
const PREVIEW_CANVAS: CanvasSize = { width: 1280, height: 720 }

const DOCK_ITEMS: Array<{ key: string; label: string; preset: LayoutPreset }> = [
  { key: 'browser-centre', label: 'Browser centre', preset: { kind: 'browser-centre' } },
  { key: 'six', label: '6 chats', preset: { kind: 'grid', count: 6 } },
  { key: 'four', label: '4 chats', preset: { kind: 'grid', count: 4 } },
  { key: 'browser-side', label: 'Chat + browser', preset: { kind: 'browser-side' } }
]

/**
 * A footer strip that stays a thin edge until hovered, then rises to offer four starting
 * layouts. It lives outside the workspace grid row so the reveal never resizes into the
 * shared browser's native surface, which always paints above the rest of the renderer.
 */
export function LayoutDock({ onApply }: { onApply: (preset: LayoutPreset) => void }): JSX.Element {
  return <div className="layout-dock-footer" data-ui="layout.dock-footer">
    <div className="layout-dock" role="group" aria-label="Quick workspace layouts">
      {DOCK_ITEMS.map(({ key, label, preset }) => <button key={key} type="button" className="layout-dock-btn"
        data-ui="layout.dock-preset" data-ui-key={key} title={label} aria-label={label}
        onClick={() => onApply(preset)}>
        <PresetWireframe preset={preset} size={PREVIEW_CANVAS} />
        <span className="layout-dock-label">{label}</span>
      </button>)}
    </div>
  </div>
}
