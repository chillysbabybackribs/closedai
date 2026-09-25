import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { desktopWallpaperPath, readDesktopWallpaper, wallpaperPathFromGSettings } from './desktop-wallpaper.js'

function settings(values: Record<string, string>) {
  return async (schema: string, key: string) => values[`${schema} ${key}`] ?? null
}

test('gsettings file URIs become local paths; other values do not', () => {
  assert.equal(wallpaperPathFromGSettings("'file:///usr/share/backgrounds/Fuji%20san.png'\n"), '/usr/share/backgrounds/Fuji san.png')
  assert.equal(wallpaperPathFromGSettings("''"), null)
  assert.equal(wallpaperPathFromGSettings("'https://example.com/a.png'"), null)
  assert.equal(wallpaperPathFromGSettings(null), null)
})

test('the dark colour scheme prefers the dark wallpaper and falls back to the light one', async () => {
  const dark = settings({
    "org.gnome.desktop.interface color-scheme": "'prefer-dark'",
    'org.gnome.desktop.background picture-uri': "'file:///w/light.jpg'",
    'org.gnome.desktop.background picture-uri-dark': "'file:///w/dark.png'"
  })
  assert.equal(await desktopWallpaperPath(dark), '/w/dark.png')
  const lightOnly = settings({
    "org.gnome.desktop.interface color-scheme": "'prefer-dark'",
    'org.gnome.desktop.background picture-uri': "'file:///w/light.jpg'"
  })
  assert.equal(await desktopWallpaperPath(lightOnly), '/w/light.jpg')
})

test('slideshow XML and non-GNOME desktops paint nothing', async () => {
  assert.equal(await desktopWallpaperPath(settings({ 'org.gnome.desktop.background picture-uri': "'file:///w/show.xml'" })), null)
  assert.equal(await readDesktopWallpaper(settings({})), null)
})

test('the wallpaper file is returned with its name and image type', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wallpaper-'))
  const file = join(dir, 'Fuji.PNG')
  await writeFile(file, Buffer.from([1, 2, 3]))
  const wallpaper = await readDesktopWallpaper(settings({ 'org.gnome.desktop.background picture-uri': `'file://${file}'` }))
  assert.equal(wallpaper?.name, 'Fuji.PNG')
  assert.equal(wallpaper?.mimeType, 'image/png')
  assert.deepEqual([...wallpaper!.bytes], [1, 2, 3])
})
