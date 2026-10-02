import { EventEmitter } from 'node:events'
import type { BrowserState } from '../../shared/types.js'

export const VIDEO_HUB_KEY = 'closedai:video-home'

/** Browser tab that shows the in-app video library (search, open, recents). */
export class VideoHubTab extends EventEmitter {
  private customTitle: string | null = null
  constructor(
    readonly id: string,
    readonly key: string,
    public previousTabId: string | null
  ) { super() }

  getState(): BrowserState {
    return {
      videoHub: { tabId: this.id },
      url: 'closedai:video-home',
      title: 'Video',
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

  reload(): void { this.emit('state') }
  dispose(): void { this.removeAllListeners() }
}
