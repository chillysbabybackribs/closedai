/** Wallpaper bytes main reads for the workspace backdrop: the OS desktop wallpaper or a saved upload. */
export type DesktopWallpaper = {
  /** File name only, for display in Settings. */
  name: string
  mimeType: string
  bytes: Uint8Array
}
