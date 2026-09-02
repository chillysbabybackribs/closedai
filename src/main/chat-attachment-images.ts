import { nativeImage } from 'electron'
import type { ChatAttachment } from '../shared/chat.js'

// Images the user pastes into the composer arrive as full-size PNG data URLs (a 2560-wide
// screenshot is ~600 KB). Codex keeps user messages verbatim through every compaction, so a
// pasted screenshot is replayed on every call for the life of the thread. Image tokens scale
// with pixels, so the copy the model gets is bounded here, the same way tool captures are.

const MAX_WIDTH = 1_600
const MAX_HEIGHT = 1_200
const JPEG_QUALITY = 85
/** Below this many bytes a paste is already cheap; re-encoding would only lose quality. */
const SKIP_BELOW_BYTES = 120_000

/** Return the attachments with pasted (data URL) images bounded for the model. */
export function shrinkPastedImages(attachments: ChatAttachment[]): ChatAttachment[] {
  return attachments.map((attachment) => {
    if (attachment.kind !== 'image' || attachment.source.type !== 'url') return attachment
    const url = attachment.source.url
    if (url.length < SKIP_BELOW_BYTES) return attachment
    const shrunk = shrinkDataUrl(url)
    return shrunk ? { ...attachment, source: { type: 'url', url: shrunk } } : attachment
  })
}

function shrinkDataUrl(url: string): string | null {
  try {
    const image = nativeImage.createFromDataURL(url)
    const { width, height } = image.getSize()
    if (image.isEmpty() || width === 0 || height === 0) return null
    const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height)
    const fitted = scale < 1
      ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'best' })
      : image
    const jpeg = `data:image/jpeg;base64,${fitted.toJPEG(JPEG_QUALITY).toString('base64')}`
    // Only swap when it actually helps; a small PNG can re-encode larger as JPEG.
    return jpeg.length < url.length ? jpeg : null
  } catch {
    return null
  }
}
