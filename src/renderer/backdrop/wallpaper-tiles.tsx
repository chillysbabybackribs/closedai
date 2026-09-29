import type { JSX } from 'react'
import { Check, Plus, Trash2, Upload } from 'lucide-react'

/* Presentation pieces of the wallpaper dialog: picker tiles, the Add tile, the current-wallpaper
   preview and the whole-dialog drop overlay. State lives in wallpaper-dialog.tsx. */

export function WallpaperTile({ id, label, image, selected, onSelect, onRemove }: {
  /** The backdrop key this tile selects, also its `data-ui-key`. */
  id: string
  label: string
  image: string
  selected: boolean
  onSelect: () => void
  onRemove?: () => void
}): JSX.Element {
  return (
    <div className="wallpaper-tile" data-selected={selected || undefined}>
      <button type="button" className="wallpaper-tile-select" aria-pressed={selected}
        data-ui="wallpaper.select" data-ui-key={id} onClick={onSelect}>
        <span className="wallpaper-tile-frame" style={{ backgroundImage: `url("${image}")` }} />
        <span className="wallpaper-tile-label">{label}</span>
      </button>
      {selected && <span className="wallpaper-tile-check" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>}
      {onRemove && <button type="button" className="wallpaper-tile-remove" aria-label={`Remove ${label}`}
        data-ui="wallpaper.remove" data-ui-key={id} onClick={onRemove}>
        <Trash2 size={14} aria-hidden="true" />
      </button>}
    </div>
  )
}

export function AddImageTile({ busy, onAdd }: { busy: boolean; onAdd: () => void }): JSX.Element {
  return (
    <div className="wallpaper-tile">
      <button type="button" className="wallpaper-tile-select wallpaper-add" disabled={busy}
        data-ui="wallpaper.add" onClick={onAdd}>
        <span className="wallpaper-tile-frame">
          <span className="wallpaper-add-icon" aria-hidden="true"><Plus size={18} /></span>
        </span>
        <span className="wallpaper-tile-label">{busy ? 'Adding…' : 'Add image…'}</span>
      </button>
    </div>
  )
}

/** The current wallpaper with two small glass tiles over it, so it reads as it sits behind chats. */
export function WallpaperPreview({ image }: { image: string | null }): JSX.Element {
  return (
    <div className="wallpaper-current-preview" data-empty={image ? undefined : true}
      style={image ? { backgroundImage: `url("${image}")` } : undefined} aria-hidden="true">
      <span className="wallpaper-current-glass" />
      <span className="wallpaper-current-glass" />
    </div>
  )
}

export function WallpaperDropOverlay(): JSX.Element {
  return (
    <div className="wallpaper-drop-overlay" aria-hidden="true">
      <span className="wallpaper-drop-icon"><Upload size={20} /></span>
      <p className="wallpaper-drop-title">Drop to add to Your uploads</p>
      <p className="wallpaper-drop-hint">JPEG, PNG, WebP or AVIF · becomes the current wallpaper</p>
    </div>
  )
}
