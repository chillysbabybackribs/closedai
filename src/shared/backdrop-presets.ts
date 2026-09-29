import { isWallpaperUploadId } from './wallpaper-uploads.js'

/** Bundled workspace backdrop images, referenced as `preset:<id>` in appearance storage; uploads as `upload:<id>`. */

export const BACKDROP_PRESET_IDS = ['aurora', 'dusk', 'ocean', 'ember'] as const
export type BackdropPresetId = (typeof BACKDROP_PRESET_IDS)[number]

export const BACKDROP_PRESET_PREFIX = 'preset:'
export const BACKDROP_UPLOAD_PREFIX = 'upload:'

export type WorkspaceBackdrop =
  | 'off'
  | 'desktop'
  | `${typeof BACKDROP_PRESET_PREFIX}${BackdropPresetId}`
  | `${typeof BACKDROP_UPLOAD_PREFIX}${string}`

export const WORKSPACE_BACKDROP_DEFAULT: WorkspaceBackdrop = 'off'

export const BACKDROP_PRESET_LABELS: Record<BackdropPresetId, string> = {
  aurora: 'Aurora',
  dusk: 'Dusk',
  ocean: 'Ocean',
  ember: 'Ember'
}

export function backdropPresetId(mode: string): BackdropPresetId | null {
  if (!mode.startsWith(BACKDROP_PRESET_PREFIX)) return null
  const id = mode.slice(BACKDROP_PRESET_PREFIX.length)
  return (BACKDROP_PRESET_IDS as readonly string[]).includes(id) ? id as BackdropPresetId : null
}

export function backdropUploadId(mode: string): string | null {
  if (!mode.startsWith(BACKDROP_UPLOAD_PREFIX)) return null
  const id = mode.slice(BACKDROP_UPLOAD_PREFIX.length)
  return isWallpaperUploadId(id) ? id : null
}

/** An image the user picked, bundled or uploaded, as opposed to Off or the desktop's own wallpaper. */
export function isImageBackdrop(mode: WorkspaceBackdrop): boolean {
  return mode !== 'off' && mode !== 'desktop'
}

export function normalizeWorkspaceBackdrop(value: unknown): WorkspaceBackdrop {
  if (value === 'desktop') return 'desktop'
  if (typeof value === 'string') {
    const preset = backdropPresetId(value)
    if (preset) return `${BACKDROP_PRESET_PREFIX}${preset}`
    const upload = backdropUploadId(value)
    if (upload) return `${BACKDROP_UPLOAD_PREFIX}${upload}`
  }
  return WORKSPACE_BACKDROP_DEFAULT
}

export function workspaceBackdropActive(mode: WorkspaceBackdrop): boolean {
  return mode !== 'off'
}
