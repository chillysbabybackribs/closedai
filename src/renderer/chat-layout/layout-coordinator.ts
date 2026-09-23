import type { EnableCoordinatorResult } from '../../shared/coordinator.js'
import { withBrowser, type ChatLayout } from './layout-tree.js'

/** Layout helper when a pane is converted to coordinator mode with two workers (legacy IPC path). */
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
