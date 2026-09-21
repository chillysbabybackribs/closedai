import type { WebPermissionRequest } from '../shared/security.js'
import { DecisionBroker } from './decision-broker.js'

/** How long a permission bar waits in the browser chrome before the page's request is denied. */
export const WEB_PERMISSION_TIMEOUT_MS = 60_000

/**
 * Page permission requests (camera/microphone, screen capture, location, notifications) while
 * Settings → Security has `webPermissions` set to `ask`. Electron's handler awaits the answer.
 */
export class BrowserPermissionBroker extends DecisionBroker<WebPermissionRequest> {
  constructor(timeoutMs = WEB_PERMISSION_TIMEOUT_MS) {
    super(timeoutMs)
  }
}
