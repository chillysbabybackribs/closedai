import type { HandlerDetails, LoadURLOptions, WindowOpenHandlerResponse } from 'electron'

// Ordinary destinations belong in CodeApp's tab strip. Opener-dependent OAuth and explicit
// utility windows retain a real Chromium child because Electron 43 hangs window.open when its
// createWindow callback returns a WebContentsView or BrowserView WebContents. Featureless
// about:blank children start hidden until their first real URL reveals which path they need.

export type PopupTabRequest = {
  url: string
  activate: boolean
  options?: LoadURLOptions
}

export type PopupDecision =
  | { kind: 'tab'; response: WindowOpenHandlerResponse; tab: PopupTabRequest }
  | { kind: 'native-child'; response: WindowOpenHandlerResponse; deferred: boolean }

type PopupDetails = Pick<HandlerDetails, 'url' | 'features' | 'disposition' | 'referrer' | 'postBody'>

const AUTH_PATH = /\/(?:oauth2?|authorize|login|signin|sign-in|sso|consent)(?:[/?#]|$)/i
const AUTH_HOST = /(?:^|\.)(?:accounts?|auth|login|oauth|sso)(?:\.|$)/i
const UTILITY_FEATURE = /(?:^|,)(?:popup|width|height|left|top|screenx|screeny)=?/i

export function isOAuthDestination(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return AUTH_HOST.test(url.hostname) || AUTH_PATH.test(url.pathname)
  } catch {
    return false
  }
}

function hasUtilityWindowFeatures(features: string): boolean {
  return UTILITY_FEATURE.test(features.replace(/\s+/g, ''))
}

function tabLoadOptions(details: PopupDetails): LoadURLOptions | undefined {
  const options: LoadURLOptions = {}
  if (details.referrer?.url) options.httpReferrer = details.referrer
  if (details.postBody) {
    const contentType = details.postBody.boundary
      ? `${details.postBody.contentType}; boundary=${details.postBody.boundary}`
      : details.postBody.contentType
    options.extraHeaders = `Content-Type: ${contentType}`
    options.postData = details.postBody.data
  }
  return Object.keys(options).length > 0 ? options : undefined
}

export function decideWindowOpen(
  details: PopupDetails,
  partition: string
): PopupDecision {
  const deferred = details.url === 'about:blank' && !hasUtilityWindowFeatures(details.features)
  const nativeChild = deferred || isOAuthDestination(details.url) || hasUtilityWindowFeatures(details.features)
  if (!nativeChild) {
    return {
      kind: 'tab',
      response: { action: 'deny' },
      tab: {
        url: details.url,
        activate: details.disposition !== 'background-tab',
        options: tabLoadOptions(details)
      }
    }
  }
  return {
    kind: 'native-child',
    deferred,
    response: {
      action: 'allow',
      outlivesOpener: false,
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        ...(deferred ? { show: false } : {}),
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          partition,
          backgroundThrottling: true
        }
      }
    }
  }
}
