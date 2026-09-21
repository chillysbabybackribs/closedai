import type { CredentialApprovalRequest, SecurityDecision, WebPermissionRequest } from '../shared/security.js'

/**
 * The renderer's one seam to the security prompt IPC: credential approvals (Settings → Security →
 * "credentials require approval") and web permission requests (`webPermissions: 'ask'`). Both are
 * off by default; main publishes an empty pending list until the user turns one on, so the
 * surfaces built on this module render nothing in the default configuration.
 *
 * Every bridge method is named in `securityRequestsApi` alone; a rename on the preload side is a
 * one-line change here.
 */

export type SecurityRequestsApi = {
  onCredentialApprovals: (listener: (pending: CredentialApprovalRequest[]) => void) => () => void
  resolveCredentialApproval: (id: string, decision: SecurityDecision) => Promise<void>
  onPermissionRequests: (listener: (pending: WebPermissionRequest[]) => void) => () => void
  resolvePermission: (id: string, decision: SecurityDecision) => Promise<void>
}

type BridgeShape = {
  security?: Partial<Pick<SecurityRequestsApi, 'onCredentialApprovals' | 'resolveCredentialApproval'>>
  browser?: Partial<Pick<SecurityRequestsApi, 'onPermissionRequests' | 'resolvePermission'>>
}

/**
 * The bridge methods, or null while the preload does not expose them (an older build or a UI
 * preview without the fixture). Null keeps the surfaces silent instead of throwing at mount.
 */
export function securityRequestsApi(bridge: unknown = window.closedai): SecurityRequestsApi | null {
  const { security, browser } = (bridge ?? {}) as BridgeShape
  if (!security?.onCredentialApprovals || !security.resolveCredentialApproval) return null
  if (!browser?.onPermissionRequests || !browser.resolvePermission) return null
  return {
    onCredentialApprovals: security.onCredentialApprovals,
    resolveCredentialApproval: security.resolveCredentialApproval,
    onPermissionRequests: browser.onPermissionRequests,
    resolvePermission: browser.resolvePermission
  }
}

type PendingRequest = { id: string }

/** One kind of request: the pending list as the surfaces should show it, and the way to answer. */
export type SecurityRequestFeed<T extends PendingRequest> = {
  /** Calls back with the current list at once when one is known, then on every change. */
  subscribe: (listener: (pending: T[]) => void) => () => void
  /** Hides the request immediately; a rejected resolve restores it and rethrows for the caller's notice. */
  resolve: (id: string, decision: SecurityDecision) => Promise<void>
}

export type SecurityRequestsController = {
  credentials: SecurityRequestFeed<CredentialApprovalRequest>
  permissions: SecurityRequestFeed<WebPermissionRequest>
}

function createFeed<T extends PendingRequest>(
  subscribeSource: (listener: (pending: T[]) => void) => () => void,
  resolveSource: (id: string, decision: SecurityDecision) => Promise<void>
): SecurityRequestFeed<T> {
  const listeners = new Set<(pending: T[]) => void>()
  // Answered but not yet dropped by main. Pruned when the source list stops carrying the id, so a
  // request id never accumulates here beyond its own lifetime.
  const hidden = new Set<string>()
  let source: T[] | null = null
  let release: (() => void) | null = null
  const visible = (): T[] => (source ?? []).filter((request) => !hidden.has(request.id))
  const publish = (): void => { const pending = visible(); listeners.forEach((listener) => listener(pending)) }
  const receive = (pending: T[]): void => {
    source = pending
    for (const id of hidden) if (!pending.some((request) => request.id === id)) hidden.delete(id)
    publish()
  }
  return {
    subscribe(listener) {
      listeners.add(listener)
      if (!release) release = subscribeSource(receive)
      else if (source) listener(visible())
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && release) { release(); release = null; source = null; hidden.clear() }
      }
    },
    async resolve(id, decision) {
      hidden.add(id)
      publish()
      try {
        await resolveSource(id, decision)
      } catch (error) {
        hidden.delete(id)
        publish()
        throw error
      }
    }
  }
}

/** One shared feed per request kind: many chat panes subscribe, main is subscribed to once. */
export function createSecurityRequestsController(api: SecurityRequestsApi | null): SecurityRequestsController {
  if (!api) {
    const silent = <T extends PendingRequest>(): SecurityRequestFeed<T> => ({
      subscribe: () => () => {},
      resolve: async () => { throw new Error('Security prompts are not available in this build') }
    })
    return { credentials: silent(), permissions: silent() }
  }
  return {
    credentials: createFeed(api.onCredentialApprovals, api.resolveCredentialApproval),
    permissions: createFeed(api.onPermissionRequests, api.resolvePermission)
  }
}

let shared: SecurityRequestsController | null = null

/** The renderer-wide controller over `window.closedai`, created on first use. */
export function securityRequests(): SecurityRequestsController {
  shared ??= createSecurityRequestsController(securityRequestsApi())
  return shared
}

/**
 * The approvals one chat pane shows: its own agent's requests, plus, in the selected pane only,
 * requests without a pane or from a pane no longer open, so no request waits where nobody looks.
 */
export function credentialRequestsForPane(
  pending: CredentialApprovalRequest[], paneId: string, selected: boolean, openPaneIds: readonly string[]
): CredentialApprovalRequest[] {
  return pending.filter((request) => request.paneId === paneId
    || (selected && (request.paneId === null || !openPaneIds.includes(request.paneId))))
}

/** Only the active tab's requests show; the rest wait for their tab (main expires them after 60 s). */
export function permissionRequestsForTab(pending: WebPermissionRequest[], activeTabId: string | null): WebPermissionRequest[] {
  return activeTabId ? pending.filter((request) => request.tabId === activeTabId) : []
}
