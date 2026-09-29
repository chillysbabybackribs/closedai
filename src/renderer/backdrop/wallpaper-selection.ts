import {
  backdropPresetId,
  backdropUploadId,
  BACKDROP_PRESET_LABELS,
  isImageBackdrop,
  type WorkspaceBackdrop
} from '../../shared/backdrop-presets.js'
import type { BackdropStatus } from './use-workspace-backdrop.js'

/* What the wallpaper dialog says about a selection, and where Image mode returns to. Pure, so the
   copy for every source and status is testable without rendering the dialog. */

export type WallpaperMode = 'image' | 'desktop' | 'off'

/** Image mode's target when nothing was picked yet: the first bundled preset. */
export const DEFAULT_IMAGE_BACKDROP: WorkspaceBackdrop = 'preset:aurora'

export type WallpaperDescription = { name: string; source: string }

export function wallpaperMode(backdrop: WorkspaceBackdrop): WallpaperMode {
  return isImageBackdrop(backdrop) ? 'image' : backdrop === 'off' ? 'off' : 'desktop'
}

export function describeWallpaper(
  backdrop: WorkspaceBackdrop,
  status: BackdropStatus,
  uploadName: (id: string) => string | null
): WallpaperDescription {
  if (backdrop === 'off') return { name: 'No wallpaper', source: 'Plain workspace background' }
  if (backdrop === 'desktop') {
    if (status.state === 'unavailable') return { name: 'Desktop wallpaper', source: 'No desktop wallpaper found' }
    return {
      name: 'Desktop wallpaper',
      source: status.state === 'ready' ? `Follows your system wallpaper · ${status.name}` : 'Follows your system wallpaper'
    }
  }
  const preset = backdropPresetId(backdrop)
  if (preset) return { name: BACKDROP_PRESET_LABELS[preset], source: 'Curated · bundled with ClosedAI' }
  const upload = backdropUploadId(backdrop)
  const file = (upload && uploadName(upload)) ?? (status.state === 'ready' ? status.name : null)
  if (!file) {
    return {
      name: 'Uploaded image',
      source: status.state === 'unavailable' ? 'This image is no longer on this device' : 'Your uploads'
    }
  }
  return { name: file.replace(/\.[^.]+$/, ''), source: `Your uploads · ${file}` }
}

/** After an upload is deleted: what stays selected and where Image mode returns to. */
export function afterUploadRemoved(
  removed: WorkspaceBackdrop,
  selected: WorkspaceBackdrop,
  lastImage: WorkspaceBackdrop
): { selected: WorkspaceBackdrop; lastImage: WorkspaceBackdrop } {
  const nextImage = lastImage === removed ? DEFAULT_IMAGE_BACKDROP : lastImage
  return { selected: selected === removed ? nextImage : selected, lastImage: nextImage }
}
