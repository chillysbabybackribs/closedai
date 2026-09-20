import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import type { BrowserState } from '../../shared/types.js'
import type { ImageTabContent } from '../../shared/local-files.js'

/** An inert image in the app renderer, with no native browser surface or page privileges. */
export class ImageTab extends EventEmitter {
  private customTitle: string | null = null
  constructor(
    readonly id: string,
    readonly key: string,
    readonly content: ImageTabContent,
    public previousTabId: string | null
  ) { super() }

  getState(): BrowserState {
    const { name, path } = this.content
    return {
      image: { tabId: this.id, name, ...(path ? { path } : {}) },
      url: path ? pathToFileURL(path).href : `closedai-image:${this.id}`,
      title: name, isLoading: false, canGoBack: false, canGoForward: false, navigationError: null
    }
  }
  getFavicon(): null { return null }
  getCustomTitle(): string | null { return this.customTitle }
  exportNavigationStack(): null { return null }
  rename(title: string | null): void {
    this.customTitle = title?.trim().slice(0, 300) || null
    this.emit('state')
  }
  reload(): void { this.emit('state') }
  dispose(): void { this.removeAllListeners() }
}

/** Only inert raster data and web image URLs may reach an <img>; local paths use openLocalFile. */
export function validateImageSource(input: { name: string; src: string }): ImageTabContent {
  if (!input || typeof input.name !== 'string' || typeof input.src !== 'string') {
    throw new Error('An image name and source are required.')
  }
  const src = input.src
  const raster = /^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,[a-zA-Z0-9+/=\r\n]+$/.test(src)
  let remote = false
  try { remote = ['https:', 'http:'].includes(new URL(src).protocol) } catch { /* Not a web URL. */ }
  if (!raster && !remote) throw new Error('This image source is not supported.')
  if (src.length > 45 * 1024 * 1024) throw new Error('Image preview supports files up to 32 MB.')
  return { name: input.name.slice(0, 300) || 'Image', src }
}

export function imageKey(content: ImageTabContent): string {
  return content.path ?? createHash('sha256').update(content.src).digest('hex')
}
