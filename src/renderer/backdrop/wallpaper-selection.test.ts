import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceBackdrop } from '../../shared/backdrop-presets.js'
import { afterUploadRemoved, describeWallpaper, wallpaperMode } from './wallpaper-selection.js'

const ID = '0b7f6d7e-3c1a-4c4e-9f7a-2d8e5b1c9a10'
const UPLOAD = `upload:${ID}` as WorkspaceBackdrop
const names = (id: string): string | null => (id === ID ? 'Forest trail.jpg' : null)

test('modes group bundled and uploaded images under Image', () => {
  assert.equal(wallpaperMode('preset:dusk'), 'image')
  assert.equal(wallpaperMode(UPLOAD), 'image')
  assert.equal(wallpaperMode('desktop'), 'desktop')
  assert.equal(wallpaperMode('off'), 'off')
})

test('each source names itself and where it comes from', () => {
  assert.deepEqual(describeWallpaper('preset:ocean', { state: 'loading' }, names),
    { name: 'Ocean', source: 'Curated · bundled with ClosedAI' })
  assert.deepEqual(describeWallpaper(UPLOAD, { state: 'loading' }, names),
    { name: 'Forest trail', source: 'Your uploads · Forest trail.jpg' })
  assert.deepEqual(describeWallpaper('off', { state: 'off' }, names),
    { name: 'No wallpaper', source: 'Plain workspace background' })
})

test('the desktop source reports the file it found, or that it found none', () => {
  assert.equal(describeWallpaper('desktop', { state: 'ready', name: 'fuji.jpg', image: 'blob:x' }, names).source,
    'Follows your system wallpaper · fuji.jpg')
  assert.equal(describeWallpaper('desktop', { state: 'unavailable' }, names).source, 'No desktop wallpaper found')
})

test('an upload missing from the list falls back to the loaded name, then to a gone notice', () => {
  const other = 'upload:11111111-1111-4111-8111-111111111111' as WorkspaceBackdrop
  assert.equal(describeWallpaper(other, { state: 'ready', name: 'City.png', image: 'blob:x' }, names).name, 'City')
  assert.equal(describeWallpaper(other, { state: 'unavailable' }, names).source, 'This image is no longer on this device')
})

test('deleting the selected upload falls back to the last image, or the default preset', () => {
  assert.deepEqual(afterUploadRemoved(UPLOAD, UPLOAD, 'preset:ember'), { selected: 'preset:ember', lastImage: 'preset:ember' })
  assert.deepEqual(afterUploadRemoved(UPLOAD, UPLOAD, UPLOAD), { selected: 'preset:aurora', lastImage: 'preset:aurora' })
  assert.deepEqual(afterUploadRemoved(UPLOAD, 'off', UPLOAD), { selected: 'off', lastImage: 'preset:aurora' })
})
