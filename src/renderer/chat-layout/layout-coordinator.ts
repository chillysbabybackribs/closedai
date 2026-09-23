import type { EnableCoordinatorResult, OpenCoordinatorWorkspaceResult } from '../../shared/coordinator.js'
import { BROWSER_PANE_ID, withBrowser, type ChatLayout } from './layout-tree.js'

/**
 * Home chat stays visible; Coordinator and Worker stack vertically between it and the browser.
 * [ anchor | coordinator / worker | browser ]
 */
export function coordinatorBrowserSideLayout(
  result: OpenCoordinatorWorkspaceResult,
  anchorPaneId: string,
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
  const crewAndBrowser: ChatLayout = {
    kind: 'split',
    id: newSplitId(),
    axis: 'horizontal',
    ratio: 0.42,
    first: stack,
    second: { kind: 'pane', id: BROWSER_PANE_ID }
  }
  return {
    kind: 'split',
    id: newSplitId(),
    axis: 'horizontal',
    ratio: 0.36,
    first: { kind: 'pane', id: anchorPaneId },
    second: crewAndBrowser
  }
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
