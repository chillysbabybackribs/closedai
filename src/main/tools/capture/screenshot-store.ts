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

export class ScreenshotStore {
  private readonly entries = new Map<string, StoredScreenshot>()
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
    this.entries.set(callId, screenshot)
    this.bytes += screenshot.dataUrl.length
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries && this.bytes <= this.maxBytes) break
      if (oldest === callId) break
      this.drop(oldest)
    }
  }

  get(callId: string): StoredScreenshot | null {
    return this.entries.get(callId) ?? null
  }

  private drop(callId: string): void {
    const existing = this.entries.get(callId)
    if (!existing) return
    this.entries.delete(callId)
    this.bytes -= existing.dataUrl.length
  }
}
