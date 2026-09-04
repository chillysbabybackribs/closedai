// Full-resolution captures the user sees in the transcript. The model receives a smaller
// encoding (its tokens scale with pixels and every image is replayed on every later turn),
// so the display copy lives here, keyed by the tool call id that the app-server also uses
// as the transcript item id. Bounded so a long UI session cannot grow memory without limit;
// evicted entries fall back to the model-sized image kept in the thread history.

export type StoredScreenshot = {
  dataUrl: string
  width: number
  height: number
  modelWidth: number
  modelHeight: number
  surface: ScreenshotSurface
  capturedAt: string
}

export type ScreenshotSurface = 'app_window' | 'browser_page' | 'crop'

const DEFAULT_MAX_ENTRIES = 60
const DEFAULT_MAX_BYTES = 96 * 1024 * 1024

// The bytes are held decoded: a base64 string of a full-resolution capture is large enough that
// keeping it on the V8 heap costs noticeably more than the Buffer it decodes to. The media type
// travels with them, because the display copy is a PNG while the model copy is a JPEG — rebuilding
// every data URL as one fixed type would hand the renderer a PNG payload labelled as a JPEG.
type InternalEntry = Omit<StoredScreenshot, 'dataUrl'> & { buffer: Buffer; mediaType: string }

const DEFAULT_MEDIA_TYPE = 'image/png'

export class ScreenshotStore {
  private readonly entries = new Map<string, InternalEntry>()
  private bytes = 0

  constructor(
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
    private readonly maxBytes = DEFAULT_MAX_BYTES
  ) {}

  get size(): number {
    return this.entries.size
  }

  retain(callId: string, screenshot: StoredScreenshot): void {
    if (!callId) return
    this.drop(callId)
    const parsed = /^data:([^;,]+);base64,(.*)$/s.exec(screenshot.dataUrl)
    const buffer = Buffer.from(parsed?.[2] ?? screenshot.dataUrl, 'base64')
    const { dataUrl, ...rest } = screenshot
    this.entries.set(callId, { ...rest, buffer, mediaType: parsed?.[1] ?? DEFAULT_MEDIA_TYPE })
    this.bytes += buffer.length
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries && this.bytes <= this.maxBytes) break
      if (oldest === callId) break
      this.drop(oldest)
    }
  }

  get(callId: string): StoredScreenshot | null {
    const entry = this.entries.get(callId)
    if (!entry) return null
    const { buffer, mediaType, ...rest } = entry
    return { ...rest, dataUrl: `data:${mediaType};base64,${buffer.toString('base64')}` }
  }

  private drop(callId: string): void {
    const existing = this.entries.get(callId)
    if (!existing) return
    this.entries.delete(callId)
    this.bytes -= existing.buffer.length
  }
}
