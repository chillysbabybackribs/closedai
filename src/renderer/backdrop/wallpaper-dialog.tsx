import { useRef, useState, type DragEvent, type JSX } from 'react'
import { ImageIcon } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog.js'
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group.js'
import {
  backdropPresetId,
  backdropUploadId,
  BACKDROP_PRESET_IDS,
  BACKDROP_PRESET_LABELS,
  BACKDROP_UPLOAD_PREFIX,
  isImageBackdrop,
  type WorkspaceBackdrop
} from '../../shared/backdrop-presets.js'
import { WALLPAPER_UPLOAD_TYPES } from '../../shared/wallpaper-uploads.js'
import { presetAssetUrl } from './backdrop-preset-assets.js'
import type { BackdropStatus } from './use-workspace-backdrop.js'
import { useWallpaperUploads, type WallpaperUploadTile } from './use-wallpaper-uploads.js'
import {
  afterUploadRemoved,
  DEFAULT_IMAGE_BACKDROP,
  describeWallpaper,
  wallpaperMode,
  type WallpaperMode
} from './wallpaper-selection.js'
import { AddImageTile, WallpaperDropOverlay, WallpaperPreview, WallpaperTile } from './wallpaper-tiles.js'

export type WallpaperDialogProps = {
  onOpenChange: (open: boolean) => void
  backdrop: WorkspaceBackdrop
  status: BackdropStatus
  onBackdropChange: (backdrop: WorkspaceBackdrop) => void
}

const MODES: Array<{ value: WallpaperMode; label: string }> = [
  { value: 'image', label: 'Image' },
  { value: 'desktop', label: 'Desktop wallpaper' },
  { value: 'off', label: 'Off' }
]

const uploadKey = (id: string): WorkspaceBackdrop => `${BACKDROP_UPLOAD_PREFIX}${id}`

/**
 * The workspace wallpaper picker. Every choice applies live so the workspace behind the dialog
 * shows it; Cancel restores the wallpaper the dialog opened with, Done and Close keep the choice.
 * Mount it only while open: the backdrop it opened with is captured on mount.
 */
export function WallpaperDialog({ onOpenChange, backdrop, status, onBackdropChange }: WallpaperDialogProps): JSX.Element {
  const [initial, setInitial] = useState(backdrop)
  const [lastImage, setLastImage] = useState(isImageBackdrop(backdrop) ? backdrop : DEFAULT_IMAGE_BACKDROP)
  const uploads = useWallpaperUploads()
  const fileInput = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)

  const select = (next: WorkspaceBackdrop): void => {
    if (isImageBackdrop(next)) setLastImage(next)
    if (next !== backdrop) onBackdropChange(next)
  }
  const importFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    const id = await uploads.add(file)
    if (id) select(uploadKey(id))
  }
  const removeUpload = async (id: string): Promise<void> => {
    if (!await uploads.remove(id)) return
    const removed = uploadKey(id)
    const next = afterUploadRemoved(removed, backdrop, lastImage)
    setLastImage(next.lastImage)
    if (initial === removed) setInitial(next.lastImage)
    if (next.selected !== backdrop) onBackdropChange(next.selected)
  }
  const cancel = (): void => {
    if (initial !== backdrop) onBackdropChange(initial)
    onOpenChange(false)
  }

  // A depth count keeps the overlay steady while the pointer crosses the dialog's children.
  const hasFiles = (event: DragEvent): boolean => event.dataTransfer.types.includes('Files')
  const dragHandlers = {
    onDragEnter: (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepth.current += 1
      setDragging(true)
    },
    onDragOver: (event: DragEvent) => { if (hasFiles(event)) event.preventDefault() },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      void importFile(event.dataTransfer.files[0])
    }
  }

  const description = describeWallpaper(backdrop, status,
    (id) => uploads.uploads.find((upload) => upload.id === id)?.name ?? null)

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="wallpaper-dialog" aria-describedby="wallpaper-description"
        data-ui="dialog.wallpaper" data-dragging={dragging || undefined} {...dragHandlers}>
        <div className="appearance-dialog-heading">
          <div className="appearance-dialog-icon" aria-hidden="true"><ImageIcon size={18} /></div>
          <div className="settings-heading-copy">
            <DialogTitle className="appearance-dialog-title">Workspace wallpaper</DialogTitle>
            <DialogDescription id="wallpaper-description">
              Choose what shows behind chat tiles. Glass and blur stay on top of your selection.
            </DialogDescription>
          </div>
        </div>

        <div className="wallpaper-dialog-body">
          <section className="wallpaper-current" aria-label="Current wallpaper">
            <WallpaperPreview image={previewImage(backdrop, status, uploads.uploads)} />
            <div className="wallpaper-current-copy">
              <span className="wallpaper-current-eyebrow">Current wallpaper</span>
              <h3 className="wallpaper-current-name">{description.name}</h3>
              <p className="wallpaper-current-source">{description.source}</p>
              <ToggleGroup type="single" variant="outline" size="sm" className="wallpaper-modes"
                value={wallpaperMode(backdrop)} aria-label="Wallpaper source"
                onValueChange={(value) => {
                  if (value) select(value === 'image' ? lastImage : value as WorkspaceBackdrop)
                }}>
                {MODES.map((mode) => (
                  <ToggleGroupItem key={mode.value} value={mode.value} className="h-7 px-3"
                    data-ui="wallpaper.mode" data-ui-key={mode.value}>
                    {mode.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </section>

          <section className="wallpaper-section">
            <div className="wallpaper-section-head">
              <h3>Curated</h3>
              <span>Bundled with ClosedAI</span>
            </div>
            <div className="wallpaper-grid">
              {BACKDROP_PRESET_IDS.map((id) => {
                const key: WorkspaceBackdrop = `preset:${id}`
                return <WallpaperTile key={id} id={key} label={BACKDROP_PRESET_LABELS[id]} image={presetAssetUrl(id)}
                  selected={backdrop === key} onSelect={() => select(key)} />
              })}
            </div>
          </section>

          <section className="wallpaper-section">
            <div className="wallpaper-section-head">
              <h3>Your uploads</h3>
              <span className={uploads.error ? 'wallpaper-error' : undefined} role={uploads.error ? 'alert' : undefined}>
                {uploads.error ?? 'Stored on this device · drop images anywhere here'}
              </span>
            </div>
            <input ref={fileInput} type="file" accept={WALLPAPER_UPLOAD_TYPES.join(',')} className="sr-only" tabIndex={-1}
              onChange={(event) => {
                void importFile(event.target.files?.[0])
                event.target.value = ''
              }} />
            <div className="wallpaper-grid">
              <AddImageTile busy={uploads.adding} onAdd={() => fileInput.current?.click()} />
              {uploads.uploads.map((upload) => {
                const key = uploadKey(upload.id)
                return <WallpaperTile key={upload.id} id={key} label={upload.name} image={upload.thumbnail}
                  selected={backdrop === key} onSelect={() => select(key)}
                  onRemove={() => void removeUpload(upload.id)} />
              })}
            </div>
          </section>
        </div>

        <footer className="wallpaper-dialog-footer">
          <Button type="button" variant="outline" size="sm" data-ui="wallpaper.cancel" onClick={cancel}>Cancel</Button>
          <Button type="button" size="sm" data-ui="wallpaper.done" onClick={() => onOpenChange(false)}>Done</Button>
        </footer>
        <WallpaperDropOverlay />
      </DialogContent>
    </Dialog>
  )
}

/** Bundled and uploaded images preview from their tile source at once; the desktop only once main has read it. */
function previewImage(backdrop: WorkspaceBackdrop, status: BackdropStatus, uploads: WallpaperUploadTile[]): string | null {
  const preset = backdropPresetId(backdrop)
  if (preset) return presetAssetUrl(preset)
  const upload = backdropUploadId(backdrop)
  if (upload) return uploads.find((tile) => tile.id === upload)?.thumbnail ?? (status.state === 'ready' ? status.image : null)
  return backdrop === 'desktop' && status.state === 'ready' ? status.image : null
}
