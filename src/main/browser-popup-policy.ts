import type { HandlerDetails, LoadURLOptions, WebContents, WebContentsViewConstructorOptions, WindowOpenHandlerResponse } from 'electron'

// Adopt Chromium's actual child WebContents, rather than canceling and loading its URL in a
// different renderer. The original WindowProxy, opener, POST and blank-window writes survive.

export type PopupTabRequest = {
  url: string
  activate: boolean
  options?: LoadURLOptions
}

export type CreatePopupTab = (options: WebContentsViewConstructorOptions, request: PopupTabRequest) => WebContents

type PopupDetails = Pick<HandlerDetails, 'url' | 'features' | 'disposition' | 'referrer' | 'postBody'>

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
  partition: string,
  createPopupTab?: CreatePopupTab
): WindowOpenHandlerResponse {
  // Public research workers have no tab host and must never create windows.
  if (!createPopupTab) return { action: 'deny' }
  return {
    action: 'allow',
    outlivesOpener: true,
    overrideBrowserWindowOptions: {
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition,
        backgroundThrottling: true,
        autoplayPolicy: 'document-user-activation-required',
        enableWebSQL: false,
        safeDialogs: true
      }
    },
    // Electron passes webContents at runtime although BrowserWindowConstructorOptions omits
    // it in its type. WebContentsView accepts it through its documented adoption option.
    createWindow: (options) => createPopupTab(options as WebContentsViewConstructorOptions, {
      url: details.url,
      activate: details.disposition !== 'background-tab',
      options: tabLoadOptions(details)
    })
  }
}
