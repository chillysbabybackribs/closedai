import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { DesktopWallpaper } from '../shared/desktop-wallpaper.js'

const run = promisify(execFile)
const MAX_WALLPAPER_BYTES = 48 * 1024 * 1024
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif'
}

type GSettingsRead = (schema: string, key: string) => Promise<string | null>

/** A `gsettings get` value like `'file:///usr/share/backgrounds/x.png'` as a local path. */
export function wallpaperPathFromGSettings(value: string | null): string | null {
  const unquoted = value?.trim().replace(/^'(.*)'$/s, '$1') ?? ''
  if (!unquoted.startsWith('file://')) return null
  try {
    return fileURLToPath(unquoted)
  } catch {
    return null
  }
}

/** GNOME keeps separate light and dark wallpapers; the active colour scheme picks which one shows. */
export async function desktopWallpaperPath(read: GSettingsRead = readGSetting): Promise<string | null> {
  const scheme = await read('org.gnome.desktop.interface', 'color-scheme')
  const keys = scheme?.includes('prefer-dark') ? ['picture-uri-dark', 'picture-uri'] : ['picture-uri', 'picture-uri-dark']
  for (const key of keys) {
    const path = wallpaperPathFromGSettings(await read('org.gnome.desktop.background', key))
    if (path && IMAGE_TYPES[extname(path).toLowerCase()]) return path
  }
  return null
}

/** The current wallpaper's bytes, or null when the desktop has none this app can paint (not GNOME, a slideshow XML, too large). */
export async function readDesktopWallpaper(read: GSettingsRead = readGSetting): Promise<DesktopWallpaper | null> {
  const path = await desktopWallpaperPath(read)
  if (!path) return null
  try {
    if ((await stat(path)).size > MAX_WALLPAPER_BYTES) return null
    return { name: basename(path), mimeType: IMAGE_TYPES[extname(path).toLowerCase()]!, bytes: await readFile(path) }
  } catch {
    return null
  }
}

async function readGSetting(schema: string, key: string): Promise<string | null> {
  try {
    const { stdout } = await run('gsettings', ['get', schema, key], { timeout: 2000 })
    return stdout
  } catch {
    return null
  }
}
