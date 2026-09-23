import { useRef, useSyncExternalStore } from 'react'
import type { WorkspacePaneSlice } from './workspace-snapshot-store.js'
import {
  getWorkspaceSnapshot,
  subscribeWorkspaceSnapshot,
  workspacePaneSlice,
  workspacePaneSliceEqual
} from './workspace-snapshot-store.js'

/** Pane-scoped workspace slice; streaming on another pane does not change this reference. */
export function useWorkspacePaneSlice(paneId: string): WorkspacePaneSlice {
  const cached = useRef<WorkspacePaneSlice>()
  return useSyncExternalStore(
    subscribeWorkspaceSnapshot,
    () => {
      const next = workspacePaneSlice(getWorkspaceSnapshot(), paneId)
      const previous = cached.current
      if (previous && workspacePaneSliceEqual(previous, next)) return previous
      cached.current = next
      return next
    },
    () => workspacePaneSlice(getWorkspaceSnapshot(), paneId)
  )
}
