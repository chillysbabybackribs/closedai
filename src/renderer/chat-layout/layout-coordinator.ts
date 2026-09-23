import type { EnableCoordinatorResult, OpenCoordinatorWorkspaceResult } from '../../shared/coordinator.js'
import { withBrowser, type ChatLayout } from './layout-tree.js'

/** Two stacked chats beside the shared browser (coordinator on top, worker below). */
export function coordinatorBrowserSideLayout(
  result: OpenCoordinatorWorkspaceResult,
  newSplitId: () => string
): ChatLayout {
  const stack: ChatLayout = {
    kind: 'split',
    id: newSplitId(),
    axis: 'vertical',
    ratio: 0.5,
    first: { kind: 'pane', id: result.coordinatorPaneId },
    second: { kind: 'pane', id: result.workerPaneId }
  }
  return withBrowser(stack)
}

/** Coordinator left; workers stacked on the right. */
export function coordinatorWorkspaceLayout(
  result: EnableCoordinatorResult,
  newSplitId: () => string
): ChatLayout {
  const [workerA, workerB] = result.workerPaneIds
  const workers: ChatLayout = {
    kind: 'split',
    id: newSplitId(),
    axis: 'vertical',
    ratio: 0.5,
    first: { kind: 'pane', id: workerA },
    second: { kind: 'pane', id: workerB }
  }
  const root: ChatLayout = {
    kind: 'split',
    id: newSplitId(),
    axis: 'horizontal',
    ratio: 0.38,
    first: { kind: 'pane', id: result.coordinatorPaneId },
    second: workers
  }
  return withBrowser(root)
}
