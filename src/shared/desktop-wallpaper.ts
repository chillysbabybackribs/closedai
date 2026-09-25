/** The operating system's current desktop wallpaper, read by main for the workspace backdrop. */
export type DesktopWallpaper = {
  /** File name only, for display in Settings. */
  name: string
  mimeType: string
  bytes: Uint8Array
}
