import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WallpaperUploadStore } from './upload-store.js'

const IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
]

async function withStore(run: (store: WallpaperUploadStore, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'wallpapers-'))
  let next = 0
  try {
    await run(new WallpaperUploadStore(dir, () => IDS[next++]!), dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const draft = (name: string, mimeType = 'image/png') => ({
  name,
  mimeType,
  bytes: new Uint8Array([1, 2, 3]),
  thumbnail: new Uint8Array([9])
})

test('uploads list newest first with thumbnails, and read returns the full image', async () => {
  await withStore(async (store) => {
    await store.add(draft('Forest.png'))
    await store.add(draft('/home/someone/City night.jpg', 'image/jpeg'))
    const listed = await store.list()
    assert.deepEqual(listed.map((upload) => [upload.id, upload.name]), [[IDS[1], 'City night.jpg'], [IDS[0], 'Forest.png']])
    assert.deepEqual([...listed[0]!.thumbnail], [9])
    const image = await store.read(IDS[1]!)
    assert.equal(image?.mimeType, 'image/jpeg')
    assert.deepEqual([...image!.bytes], [1, 2, 3])
  })
})

test('two adds at once both land in the manifest', async () => {
  await withStore(async (store) => {
    await Promise.all([store.add(draft('a.png')), store.add(draft('b.png'))])
    assert.equal((await store.list()).length, 2)
  })
})

test('remove deletes the image, the thumbnail and the manifest entry', async () => {
  await withStore(async (store, dir) => {
    await store.add(draft('Forest.png'))
    await store.remove(IDS[0]!)
    assert.deepEqual(await store.list(), [])
    assert.equal(await store.read(IDS[0]!), null)
    assert.deepEqual(await readdir(dir), ['uploads.json'])
  })
})

test('ids that are not UUIDs never reach the file system', async () => {
  await withStore(async (store) => {
    assert.equal(await store.read('../../etc/passwd'), null)
    await store.remove('../uploads')
  })
})

test('unsupported, empty and oversized images are refused', async () => {
  await withStore(async (store) => {
    await assert.rejects(store.add(draft('x.gif', 'image/gif')), /JPEG, PNG, WebP or AVIF/)
    await assert.rejects(store.add({ ...draft('x.png'), bytes: new Uint8Array() }), /empty/)
    await assert.rejects(store.add({ ...draft('x.png'), bytes: new Uint8Array(48 * 1024 * 1024 + 1) }), /48 MB/)
    assert.deepEqual(await store.list(), [])
  })
})
