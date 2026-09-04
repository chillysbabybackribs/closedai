import type { Session } from 'electron'
import { flattenHeaders, type NetworkLog, type NetworkPostData } from './network-log.js'
import type { NetworkRules } from './network-rules.js'

// Wires the session's webRequest lifecycle into the log and lets the rules act at the two
// blocking stages Electron offers. Electron allows one listener per webRequest event per
// session, so every stage used here is owned here; the request-header stage belongs to
// browser-auth-client-hints.ts, which composes the rules through `requestHeaderInjector`.

export type NetworkObserverDeps = {
  log: NetworkLog
  rules: NetworkRules
  /** Resolve the tab that issued a request; null for the session's own traffic. */
  tabIdOf: (webContentsId: number | undefined) => string | null
}

/** How much of an upload body the log keeps; enough to replay JSON and form posts. */
const MAX_POST_DATA_BYTES = 64 * 1024

export function installNetworkObserver(browserSession: Session, deps: NetworkObserverDeps): void {
  const { log, rules, tabIdOf } = deps
  const idOf = (details: { id: number }): string => String(details.id)

  browserSession.webRequest.onBeforeRequest((details, callback) => {
    const tabId = tabIdOf(details.webContentsId)
    log.begin({
      id: idOf(details),
      tabId,
      url: details.url,
      method: details.method,
      resourceType: details.resourceType,
      referrer: details.referrer || null,
      postData: postDataOf(details.uploadData)
    })
    const decision = rules.decide(details.url, tabId)
    if (!decision) {
      callback({})
      return
    }
    if ('cancel' in decision) {
      log.blocked(idOf(details), decision.ruleId)
      callback({ cancel: true })
      return
    }
    log.blocked(idOf(details), decision.ruleId, decision.redirectUrl)
    callback({ redirectURL: decision.redirectUrl })
  })

  browserSession.webRequest.onSendHeaders((details) => {
    log.requestHeaders(idOf(details), flattenHeaders(details.requestHeaders))
  })

  browserSession.webRequest.onBeforeRedirect((details) => {
    log.redirected(idOf(details), details.redirectURL, details.statusCode ?? null)
  })

  browserSession.webRequest.onHeadersReceived((details, callback) => {
    const headers: Record<string, string | string[]> = { ...(details.responseHeaders ?? {}) }
    rules.applyResponseHeaders(details.url, tabIdOf(details.webContentsId), headers)
    log.responseHeaders(idOf(details), {
      status: details.statusCode ?? null,
      statusLine: details.statusLine ?? null,
      headers: flattenHeaders(headers)
    })
    callback({ responseHeaders: headers })
  })

  browserSession.webRequest.onCompleted((details) => {
    log.complete(idOf(details), { status: details.statusCode ?? null, fromCache: details.fromCache ?? null })
  })

  browserSession.webRequest.onErrorOccurred((details) => {
    log.fail(idOf(details), details.error)
  })
}

/** Composes the rules into the session's single request-header stage. */
export function requestHeaderInjector(
  rules: NetworkRules,
  tabIdOf: (webContentsId: number | undefined) => string | null
): (url: string, headers: Record<string, string | string[]>, webContentsId?: number) => void {
  return (url, headers, webContentsId) => rules.applyRequestHeaders(url, tabIdOf(webContentsId), headers)
}

export function postDataOf(uploadData: Electron.UploadData[] | undefined): NetworkPostData | null {
  if (!uploadData || uploadData.length === 0) return null
  const chunks: Buffer[] = []
  let byteLength = 0
  let opaque = false
  for (const part of uploadData) {
    if (part.bytes) {
      byteLength += part.bytes.byteLength
      chunks.push(part.bytes)
    } else if (part.file || part.blobUUID) {
      opaque = true
    }
  }
  if (chunks.length === 0) return opaque ? { text: null, byteLength: 0, truncated: false } : null
  const joined = Buffer.concat(chunks)
  const kept = joined.subarray(0, MAX_POST_DATA_BYTES)
  const text = kept.toString('utf8')
  const printable = text.indexOf(String.fromCharCode(0)) === -1 && (text.match(/\uFFFD/g)?.length ?? 0) / Math.max(1, text.length) < 0.02
  return {
    text: printable && !opaque ? text : null,
    byteLength,
    truncated: joined.byteLength > MAX_POST_DATA_BYTES
  }
}
