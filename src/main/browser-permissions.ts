import { desktopCapturer, type Session, type WebContents } from 'electron'

// Owner decision (docs/electron-browser-platform-review.md §0): no permission gate anywhere.
// Every Chromium permission request, permission check, and device request is granted, and
// device pickers auto-select the first candidate instead of prompting.

export function installPermissionPolicy(browserSession: Session): void {
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(true))
  browserSession.setPermissionCheckHandler(() => true)
  browserSession.setDevicePermissionHandler(() => true)
  browserSession.setDisplayMediaRequestHandler((request, callback) => {
    void desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
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
    callback(details.deviceList[0]?.deviceId ?? '')
  })
  browserSession.on('select-serial-port', (event, portList, _contents, callback) => {
    event.preventDefault()
    callback(portList[0]?.portId ?? '')
  })
  browserSession.on('select-usb-device', (event, details, callback) => {
    event.preventDefault()
    callback(details.deviceList[0]?.deviceId)
  })
}

/** Per-WebContents half of the same policy: Web Bluetooth pickers live on the contents. */
export function installContentsPermissionPolicy(contents: WebContents): void {
  contents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault()
    callback(devices[0]?.deviceId ?? '')
  })
}
