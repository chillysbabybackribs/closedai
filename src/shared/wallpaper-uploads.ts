/** Images the user added to the workspace wallpaper picker, stored by main under the profile. */

export const WALLPAPER_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const
export type WallpaperUploadType = (typeof WALLPAPER_UPLOAD_TYPES)[number]

/** Same ceiling main applies to the desktop wallpaper it reads. */
export const WALLPAPER_UPLOAD_MAX_BYTES = 48 * 1024 * 1024

const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Upload ids are UUIDs so they are safe as file names and in `upload:<id>` backdrop keys. */
export function isWallpaperUploadId(value: string): boolean {
  return UPLOAD_ID.test(value)
}

export function isWallpaperUploadType(value: string): value is WallpaperUploadType {
  return (WALLPAPER_UPLOAD_TYPES as readonly string[]).includes(value)
}

/** One saved upload as the picker lists it: a small JPEG thumbnail, never the full image. */
export type WallpaperUpload = {
  id: string
  /** The original file name, for the tile label and the current-wallpaper card. */
  name: string
  thumbnail: Uint8Array
}

/** What the renderer sends to add an upload: the file's bytes plus a thumbnail it already drew. */
export type WallpaperUploadDraft = {
  name: string
  mimeType: string
  bytes: Uint8Array
  thumbnail: Uint8Array
}
