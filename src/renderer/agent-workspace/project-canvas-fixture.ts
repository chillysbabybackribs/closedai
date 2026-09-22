import type { DirectionRecord } from '../../shared/project/direction.js'
import type { TreeNode } from '../../shared/project/tree.js'
import { advanceDiscovery, createDiscovery, type DiscoveryState } from './project-discovery.js'
import type { JournalLine } from './project-files.js'
import { applyEvent, buildDispatchPlan, rootNode } from './project-tree.js'

/** Sample direction used by preview canvas bootstrap and tests. */
export const SAMPLE_DIRECTION_IDEA =
  'A desktop research tool for journalists that links captured source pages to claims.'

export function sampleDirectionRecord(): DirectionRecord {
  let state = createDiscovery()
  state = advanceDiscovery(state, SAMPLE_DIRECTION_IDEA).state
  state = advanceDiscovery(state, 'Investigative journalists at small newsrooms.').state
  state = advanceDiscovery(state, 'Capture a source page and link it to one claim in a draft.').state
  const final = advanceDiscovery(state, 'Not a general note app; offline-first and citations are non-negotiable.')
  return final.state.record
}

export type ProjectCanvasFixture = {
  discovery: DiscoveryState
  tree: TreeNode[]
  journal: JournalLine[]
  confirmedAt: number
  caughtUpAt: number
}

/** Pre-start canvas state with dispatch plan applied immediately (no live timers). */
export function buildProjectCanvasFixture(now = Date.now() - 120_000): ProjectCanvasFixture {
  const record = sampleDirectionRecord()
  const discovery: DiscoveryState = { record, asking: null }
  const confirmedAt = now
  const root = rootNode(record, confirmedAt)
  let tree: TreeNode[] = [root]
  const journal: JournalLine[] = [{
    id: 1,
    at: confirmedAt,
    text: 'Direction confirmed. Working from the record; only the next useful moves are planned.'
  }]
  let lineId = 2
  for (const event of buildDispatchPlan(record)) {
    const at = confirmedAt + event.delay
    tree = applyEvent(tree, event, at)
    journal.push({ id: lineId++, at, text: event.note })
  }
  return { discovery, tree, journal, confirmedAt, caughtUpAt: confirmedAt }
}
