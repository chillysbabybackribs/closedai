import type { DesktopCapturerSource, Session, WebContents } from 'electron'
import type { WebPermissionKind, WebPermissionPolicy, WebPermissionRequest } from '../shared/security.js'

// Owner decision (docs/electron-browser-platform-review.md §0): the historical policy grants every
// Chromium permission request, permission check, and device request, and device pickers choose the
// first candidate instead of prompting. That remains the `allow` default. Settings → Security can
// switch the four prompts Chrome shows (camera/microphone, screen capture, location, notifications)
// to `ask` or `block`; everything else (clipboard, fullscreen, pointer lock, …) is granted as Chrome
// grants it without a prompt.

export type PermissionPolicyDeps = {
  policy: () => WebPermissionPolicy
  /** Show the request in the browser chrome and wait; false on deny or timeout. */
  ask: (request: Omit<WebPermissionRequest, 'id' | 'requestedAt'>) => Promise<boolean>
  /** The tab behind a WebContents, so the bar appears on the right tab. */
  tabIdFor: (contents: WebContents) => string | null
  /** Screen and window sources for getDisplayMedia; the first is used, as it always was. */
  captureSources: () => Promise<DesktopCapturerSource[]>
}

const PROMPTED: Partial<Record<string, WebPermissionKind>> = {
  media: 'media', 'display-capture': 'display-capture', geolocation: 'geolocation', notifications: 'notifications'
}

/** Linux screencast portals block on every desktopCapturer call; embedded pages use closedai_ui.capture instead. */
export function autoGrantEmbeddedDisplayMedia(): boolean {
  return process.platform !== 'linux'
}

/** The four kinds Chrome prompts for; anything else is never gated. */
export function promptedPermission(permission: string): WebPermissionKind | null {
  return PROMPTED[permission] ?? null
}

export function installPermissionPolicy(browserSession: Session, deps: PermissionPolicyDeps): void {
  const blocked = (): boolean => deps.policy() === 'block'
  browserSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const kind = promptedPermission(permission)
    const policy = kind ? deps.policy() : 'allow'
    if (policy === 'allow') { callback(true); return }
    if (policy === 'block') { callback(false); return }
    const origin = originOf(details.requestingUrl || contents.getURL())
    deps.ask({ tabId: deps.tabIdFor(contents) ?? '', origin, permission: kind! }).then(callback, () => callback(false))
  })
  // Synchronous checks (Notification.permission, enumerateDevices labels) only say no under block.
  browserSession.setPermissionCheckHandler((_contents, permission) => !(blocked() && promptedPermission(permission)))
  browserSession.setDevicePermissionHandler(() => !blocked())
  browserSession.setDisplayMediaRequestHandler((request, callback) => {
    if (blocked()) { callback({}); return }
    if (!autoGrantEmbeddedDisplayMedia()) { callback({}); return }
    void deps.captureSources().then((sources) => {
      const source = sources[0]
      if (!source || !request.videoRequested) {
        callback({})
        return
      }
      callback({ video: source })
    }).catch(() => callback({}))
  })
  browserSession.on('select-hid-device', (event, details, callback) => {
    event.preventDefault()
    callback(blocked() ? '' : details.deviceList[0]?.deviceId ?? '')
  })
  browserSession.on('select-serial-port', (event, portList, _contents, callback) => {
    event.preventDefault()
    callback(blocked() ? '' : portList[0]?.portId ?? '')
  })
  browserSession.on('select-usb-device', (event, details, callback) => {
    event.preventDefault()
    callback(blocked() ? undefined : details.deviceList[0]?.deviceId)
  })
}

/** Per-WebContents half of the same policy: Web Bluetooth pickers live on the contents. */
export function installContentsPermissionPolicy(contents: WebContents, policy: () => WebPermissionPolicy = () => 'allow'): void {
  contents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault()
    callback(policy() === 'block' ? '' : devices[0]?.deviceId ?? '')
  })
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}
