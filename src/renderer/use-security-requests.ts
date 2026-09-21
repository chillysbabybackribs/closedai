import { useEffect, useState } from 'react'

import type { CredentialApprovalRequest, WebPermissionRequest } from '../shared/security.js'
import {
  credentialRequestsForPane, permissionRequestsForTab, securityRequests, type SecurityRequestsController
} from './security-requests.js'

/**
 * The pending credential approvals one chat pane shows. Subscribes on mount, releases on unmount;
 * the list is empty while Settings → Security leaves approvals off, so the pane renders nothing.
 */
export function useCredentialApprovals(
  paneId: string, selected: boolean, openPaneIds: readonly string[],
  controller: SecurityRequestsController = securityRequests()
): CredentialApprovalRequest[] {
  const [pending, setPending] = useState<CredentialApprovalRequest[]>([])
  useEffect(() => controller.credentials.subscribe(setPending), [controller])
  return credentialRequestsForPane(pending, paneId, selected, openPaneIds)
}

/** The active tab's pending web permission requests; empty unless `webPermissions` is `ask`. */
export function useWebPermissionRequests(
  activeTabId: string | null, controller: SecurityRequestsController = securityRequests()
): WebPermissionRequest[] {
  const [pending, setPending] = useState<WebPermissionRequest[]>([])
  useEffect(() => controller.permissions.subscribe(setPending), [controller])
  return permissionRequestsForTab(pending, activeTabId)
}
