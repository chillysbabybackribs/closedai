import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isWallpaperUploadType,
  WALLPAPER_UPLOAD_MAX_BYTES,
  type WallpaperUpload
} from '../../shared/wallpaper-uploads.js'
import { wallpaperThumbnail } from './backdrop-image.js'

/** An upload as a picker tile: its thumbnail as an object URL this hook owns and revokes. */
export type WallpaperUploadTile = { id: string; name: string; thumbnail: string }

export type WallpaperUploads = {
  uploads: WallpaperUploadTile[]
  adding: boolean
  error: string | null
  /** Stores the file and resolves its id, or null when it was refused (the reason lands in `error`). */
  add: (file: File) => Promise<string | null>
  remove: (id: string) => Promise<void>
}

/** The picker's "Your uploads": listed from main while the dialog is mounted. */
export function useWallpaperUploads(): WallpaperUploads {
  const [uploads, setUploads] = useState<WallpaperUploadTile[]>([])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const urls = useRef(new Set<string>())

  const tile = useCallback((upload: WallpaperUpload): WallpaperUploadTile => {
    const thumbnail = URL.createObjectURL(new Blob([upload.thumbnail as BlobPart], { type: 'image/jpeg' }))
    urls.current.add(thumbnail)
    return { id: upload.id, name: upload.name, thumbnail }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.closedai.wallpapers.list().then((listed) => {
      if (!cancelled) setUploads(listed.map(tile))
    }, () => {
      if (!cancelled) setError('Could not load your uploads')
    })
    const owned = urls.current
    return () => {
      cancelled = true
      for (const url of owned) URL.revokeObjectURL(url)
      owned.clear()
    }
  }, [tile])

  const add = useCallback(async (file: File): Promise<string | null> => {
    if (!isWallpaperUploadType(file.type)) {
      setError(`${file.name} is not a JPEG, PNG, WebP or AVIF image`)
      return null
    }
    if (file.size > WALLPAPER_UPLOAD_MAX_BYTES) {
      setError(`${file.name} is larger than 48 MB`)
      return null
    }
    setAdding(true)
    setError(null)
    try {
      const [bytes, thumbnail] = await Promise.all([
        file.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
        wallpaperThumbnail(file)
      ])
      const upload = await window.closedai.wallpapers.add({ name: file.name, mimeType: file.type, bytes, thumbnail })
      setUploads((current) => [tile(upload), ...current])
      return upload.id
    } catch {
      setError(`Could not add ${file.name}`)
      return null
    } finally {
      setAdding(false)
    }
  }, [tile])

  const remove = useCallback(async (id: string): Promise<void> => {
    setError(null)
    try {
      await window.closedai.wallpapers.remove(id)
    } catch {
      setError('Could not remove that image')
      return
    }
    setUploads((current) => {
      const gone = current.find((upload) => upload.id === id)
      if (gone) {
        URL.revokeObjectURL(gone.thumbnail)
        urls.current.delete(gone.thumbnail)
      }
      return current.filter((upload) => upload.id !== id)
    })
  }, [])

  return { uploads, adding, error, add, remove }
}
