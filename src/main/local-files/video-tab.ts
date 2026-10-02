import { EventEmitter } from 'node:events'
import { pathToFileURL } from 'node:url'
import type { BrowserState } from '../../shared/types.js'
import type { VideoTabContent } from '../../shared/local-files.js'

/** Local video in the app renderer, with no native browser surface. */
export class VideoTab extends EventEmitter {
  private customTitle: string | null = null
  private revision = 0
  constructor(
    readonly id: string,
    readonly key: string,
    readonly content: VideoTabContent,
    public previousTabId: string | null
  ) { super() }

  getState(): BrowserState {
    const { name, path } = this.content
    return {
      video: { tabId: this.id, name, path, revision: this.revision },
      url: pathToFileURL(path).href,
      title: name,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      navigationError: null
    }
  }

  getFavicon(): null { return null }
  getCustomTitle(): string | null { return this.customTitle }
  exportNavigationStack(): null { return null }

  rename(title: string | null): void {
    this.customTitle = title?.trim().slice(0, 300) || null
    this.emit('state')
  }

  reload(): void {
    this.revision += 1
    this.emit('state')
  }
  dispose(): void { this.removeAllListeners() }
}

export function videoKey(content: VideoTabContent): string {
  return content.path
}
