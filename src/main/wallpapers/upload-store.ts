import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { DesktopWallpaper } from '../../shared/desktop-wallpaper.js'
import {
  isWallpaperUploadId,
  isWallpaperUploadType,
  WALLPAPER_UPLOAD_MAX_BYTES,
  type WallpaperUpload,
  type WallpaperUploadDraft,
  type WallpaperUploadType
} from '../../shared/wallpaper-uploads.js'

/* One directory under the profile: `<id>.<ext>` for the image, `<id>.thumb.jpg` for the tile, and a
   manifest that keeps names and newest-first order. The renderer only ever names ids; every path is
   built here from a validated UUID, so a stored backdrop key cannot reach outside the directory. */

type Entry = { id: string; name: string; mimeType: WallpaperUploadType; addedAt: string }

const MANIFEST = 'uploads.json'
const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024
const NAME_MAX = 200
const EXTENSIONS: Record<WallpaperUploadType, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif'
}

export class WallpaperUploadStore {
  // Adds and removes rewrite the manifest; chaining them keeps two quick drops from losing one.
  private writes: Promise<unknown> = Promise.resolve()

  constructor(private readonly dir: string, private readonly newId: () => string = randomUUID) {}

  async list(): Promise<WallpaperUpload[]> {
    const entries = await this.entries()
    const uploads = await Promise.all(entries.map(async (entry) => {
      const thumbnail = await readFile(this.thumbnailPath(entry.id)).catch(() => null)
      return thumbnail ? { id: entry.id, name: entry.name, thumbnail } : null
    }))
    return uploads.filter((upload): upload is WallpaperUpload => upload !== null)
  }

  async add(draft: WallpaperUploadDraft): Promise<WallpaperUpload> {
    const { name, mimeType, bytes, thumbnail } = validDraft(draft)
    return this.serial(async () => {
      await mkdir(this.dir, { recursive: true })
      const id = this.newId()
      await writeFile(this.imagePath(id, mimeType), bytes)
      await writeFile(this.thumbnailPath(id), thumbnail)
      const entries = await this.entries()
      await this.writeEntries([{ id, name, mimeType, addedAt: new Date().toISOString() }, ...entries])
      return { id, name, thumbnail }
    })
  }

  async read(id: string): Promise<DesktopWallpaper | null> {
    if (!isWallpaperUploadId(id)) return null
    const entry = (await this.entries()).find((candidate) => candidate.id === id)
    if (!entry) return null
    const bytes = await readFile(this.imagePath(id, entry.mimeType)).catch(() => null)
    return bytes ? { name: entry.name, mimeType: entry.mimeType, bytes } : null
  }

  remove(id: string): Promise<void> {
    if (!isWallpaperUploadId(id)) return Promise.resolve()
    return this.serial(async () => {
      const entries = await this.entries()
      const entry = entries.find((candidate) => candidate.id === id)
      if (!entry) return
      await this.writeEntries(entries.filter((candidate) => candidate.id !== id))
      await rm(this.imagePath(id, entry.mimeType), { force: true })
      await rm(this.thumbnailPath(id), { force: true })
    })
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writes.then(work, work)
    this.writes = next.catch(() => undefined)
    return next
  }

  private async entries(): Promise<Entry[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.dir, MANIFEST), 'utf8'))
      return Array.isArray(parsed) ? parsed.filter(isEntry) : []
    } catch {
      return []
    }
  }

  private async writeEntries(entries: Entry[]): Promise<void> {
    const target = join(this.dir, MANIFEST)
    const temp = `${target}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(entries, null, 2)}\n`)
    await rename(temp, target)
  }

  private imagePath(id: string, mimeType: WallpaperUploadType): string {
    return join(this.dir, `${id}${EXTENSIONS[mimeType]}`)
  }

  private thumbnailPath(id: string): string {
    return join(this.dir, `${id}.thumb.jpg`)
  }
}

function validDraft(draft: WallpaperUploadDraft): Entry & Pick<WallpaperUploadDraft, 'bytes' | 'thumbnail'> {
  if (!draft || typeof draft !== 'object') throw new Error('Wallpaper upload is missing')
  if (typeof draft.mimeType !== 'string' || !isWallpaperUploadType(draft.mimeType)) {
    throw new Error('Wallpaper must be a JPEG, PNG, WebP or AVIF image')
  }
  if (!(draft.bytes instanceof Uint8Array) || draft.bytes.byteLength === 0) throw new Error('Wallpaper image is empty')
  if (draft.bytes.byteLength > WALLPAPER_UPLOAD_MAX_BYTES) throw new Error('Wallpaper image is larger than 48 MB')
  if (!(draft.thumbnail instanceof Uint8Array) || draft.thumbnail.byteLength === 0
    || draft.thumbnail.byteLength > THUMBNAIL_MAX_BYTES) {
    throw new Error('Wallpaper thumbnail is missing or too large')
  }
  const name = basename(typeof draft.name === 'string' ? draft.name : '').trim().slice(0, NAME_MAX) || 'Image'
  return { id: '', name, mimeType: draft.mimeType, addedAt: '', bytes: draft.bytes, thumbnail: draft.thumbnail }
}

function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string' && isWallpaperUploadId(entry.id)
    && typeof entry.name === 'string'
    && typeof entry.mimeType === 'string' && isWallpaperUploadType(entry.mimeType)
}
