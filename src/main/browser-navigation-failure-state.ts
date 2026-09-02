import type { BrowserNavigationError, BrowserState } from '../shared/types.js'
import {
  createBrowserNavigationError,
  createBrowserNavigationErrorFromMessage
} from '../shared/browser-navigation-error.js'

export class BrowserNavigationFailureState {
  private attempt: { url: string; previousUrl: string } | null = null

  begin(url: string, state: BrowserState, nativeUrl?: string): void {
    this.attempt = { url, previousUrl: this.lastUsableUrl(state, nativeUrl) }
  }

  start(url: string, state: BrowserState, nativeUrl?: string): boolean {
    if (!this.attempt || this.attempt.url !== url) this.begin(url, state, nativeUrl)
    return Boolean(state.navigationError)
  }

  succeed(state: BrowserState): BrowserState {
    this.attempt = null
    return { ...state, navigationError: null }
  }

  returnUrl(state: BrowserState): string | null {
    const previousUrl = state.navigationError?.previousUrl
    return previousUrl && previousUrl !== state.navigationError?.url ? previousUrl : null
  }

  failLoad(
    state: BrowserState,
    nativeUrl: string | undefined,
    errno: number,
    description: string,
    validatedUrl: string,
    isMainFrame: boolean
  ): BrowserState | null {
    if (errno === -3 || !isMainFrame) return null
    return this.fail(state, createBrowserNavigationError({
      url: validatedUrl || this.attempt?.url || state.url,
      previousUrl: this.attempt?.previousUrl ?? this.lastUsableUrl(state, nativeUrl),
      code: description,
      errno
    }))
  }

  failMessage(state: BrowserState, nativeUrl: string | undefined, message: string, url: string): BrowserState {
    return this.fail(state, createBrowserNavigationErrorFromMessage(
      message,
      url,
      this.attempt?.previousUrl ?? this.lastUsableUrl(state, nativeUrl)
    ))
  }

  private fail(state: BrowserState, error: BrowserNavigationError): BrowserState {
    const current = state.navigationError
    const next = current?.url === error.url && current.code === error.code
      ? { ...error, at: current.at }
      : error
    this.attempt = null
    return { ...state, url: next.url, title: next.title, isLoading: false, navigationError: next }
  }

  private lastUsableUrl(state: BrowserState, nativeUrl?: string): string {
    return state.navigationError?.previousUrl || nativeUrl || state.url
  }
}
