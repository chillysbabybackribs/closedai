import type { JSX } from 'react'

import type { SecurityDecision, WebPermissionKind, WebPermissionRequest } from '../shared/security.js'

type Decide = (id: string, decision: SecurityDecision) => void

const PERMISSION_DESCRIPTIONS: Record<WebPermissionKind, string> = {
  media: 'camera and microphone',
  'display-capture': 'screen',
  geolocation: 'location',
  notifications: 'notifications'
}

/** What the page would get, in the words the bar uses: "wants to use your <this>". */
export function permissionDescription(kind: WebPermissionKind): string {
  return PERMISSION_DESCRIPTIONS[kind]
}

/**
 * A page's permission request, one line under the tab strip while Settings → Security →
 * web permissions is `ask` (the default, `allow`, never shows it). Only the active tab's requests
 * appear; the others wait for their tab and expire in main after 60 s.
 */
export function WebPermissionBar({ requests, onDecide }: { requests: WebPermissionRequest[]; onDecide: Decide }): JSX.Element | null {
  if (requests.length === 0) return null
  return (
    <div className="browser-permission-stack" role="region" aria-live="polite" aria-label="Site permission requests">
      {[...requests].sort((a, b) => a.requestedAt - b.requestedAt).map((request) => (
        <div key={request.id} className="browser-permission-bar" data-request-id={request.id}>
          <span className="browser-permission-text">
            <strong>{request.origin}</strong> wants to use your {permissionDescription(request.permission)}
          </span>
          <button type="button" className="browser-permission-button" data-ui="browser.permission-allow" data-ui-key={request.id}
            onClick={() => onDecide(request.id, 'allow')}>Allow</button>
          <button type="button" className="browser-permission-button" data-ui="browser.permission-block" data-ui-key={request.id}
            onClick={() => onDecide(request.id, 'deny')}>Block</button>
        </div>
      ))}
    </div>
  )
}
