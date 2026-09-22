import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'

import { canPropose, closureProgress, type AcknowledgedReport, type Proposal } from '../preview/project-closure.js'
import type { DirectionRecord } from '../../shared/project/direction.js'
import type { DiscoveryState } from '../preview/project-discovery.js'
import { deriveFiles, type JournalLine, type Location } from '../preview/project-files.js'
import { applyEvent, buildDispatchPlan, type TreeNode } from '../preview/project-tree.js'
import type { ProjectCanvasFixture } from '../preview/project-canvas-fixture.js'
import type { ProjectSnapshot } from '../../shared/project/snapshot.js'
import { hydrateFromSnapshot, shouldHydrateFromSnapshot } from './hydrate-project-snapshot.js'

const AWAY_AFTER_MS = 30_000

export const projectNodeSignature = (node: TreeNode) => `${node.state}|${node.summary}`

export function useProjectWorkspacePrototypeEffects(options: {
  phase: 'intake' | 'canvas'
  shellRef: RefObject<HTMLElement | null>
  lastInteraction: RefObject<number>
  setAwayFor: (gap: number) => void
  canvasFixture: ProjectCanvasFixture | null
  persistedApplied: RefObject<boolean>
  persistedSnapshot: ProjectSnapshot | null | undefined
  setDiscovery: (value: DiscoveryState) => void
  setPhase: (value: 'intake' | 'canvas') => void
  setTree: Dispatch<SetStateAction<TreeNode[]>>
  setJournal: Dispatch<SetStateAction<JournalLine[]>>
  setConfirmedAt: (value: number) => void
  setCaughtUpAt: (value: number) => void
  setAcceptedAt: (value: number | null) => void
  setSkipSimulatedDispatch: (value: boolean) => void
  setSeenFiles: Dispatch<SetStateAction<Record<string, string>>>
  setSeenNodes: Dispatch<SetStateAction<Record<string, string>>>
  fixtureHydration: ReturnType<typeof hydrateFromSnapshot> | null
  location: Location
  tree: TreeNode[]
  openFile: { path: string; content: string } | null
  proposal: Proposal | null
  acceptedAt: number | null
  progress: ReturnType<typeof closureProgress>
  reports: AcknowledgedReport[]
  setProposal: Dispatch<SetStateAction<Proposal | null>>
  record: DirectionRecord
  skipSimulatedDispatch: boolean
  note: (text: string) => void
}): void {
  const {
    phase, shellRef, lastInteraction, setAwayFor, canvasFixture, persistedApplied, persistedSnapshot,
    setDiscovery, setPhase, setTree, setJournal, setConfirmedAt, setCaughtUpAt, setAcceptedAt,
    setSkipSimulatedDispatch, setSeenFiles, setSeenNodes, fixtureHydration, location, tree, openFile,
    proposal, acceptedAt, progress, reports, setProposal, record, skipSimulatedDispatch, note
  } = options

  useEffect(() => {
    if (phase !== 'canvas') return
    const touch = () => {
      const gap = Date.now() - lastInteraction.current
      lastInteraction.current = Date.now()
      if (gap >= AWAY_AFTER_MS) setAwayFor(gap)
    }
    const shell = shellRef.current
    shell?.addEventListener('pointerdown', touch)
    shell?.addEventListener('keydown', touch)
    document.addEventListener('visibilitychange', touch)
    return () => {
      shell?.removeEventListener('pointerdown', touch)
      shell?.removeEventListener('keydown', touch)
      document.removeEventListener('visibilitychange', touch)
    }
  }, [phase, shellRef, lastInteraction, setAwayFor])

  useEffect(() => {
    if (canvasFixture || persistedApplied.current || !persistedSnapshot || !shouldHydrateFromSnapshot(persistedSnapshot)) return
    persistedApplied.current = true
    const hydration = hydrateFromSnapshot(persistedSnapshot)
    setDiscovery(hydration.discovery)
    setPhase(hydration.phase)
    setTree(hydration.tree)
    setJournal(hydration.journal)
    setConfirmedAt(hydration.confirmedAt)
    setCaughtUpAt(hydration.caughtUpAt)
    setAcceptedAt(hydration.acceptedAt)
    setSkipSimulatedDispatch(hydration.skipSimulatedDispatch)
    const initial = deriveFiles({
      record: hydration.discovery.record, messages: [], nodes: hydration.tree, journal: hydration.journal,
      edits: {}, confirmedAt: hydration.confirmedAt, reports: [], progress: closureProgress(hydration.tree, hydration.discovery.record),
      proposal: null, acceptedAt: hydration.acceptedAt
    })
    setSeenFiles(Object.fromEntries(initial.map((file) => [file.path, file.content])))
    setSeenNodes(Object.fromEntries(hydration.tree.map((node) => [node.id, projectNodeSignature(node)])))
  }, [canvasFixture, persistedSnapshot, persistedApplied, setDiscovery, setPhase, setTree, setJournal, setConfirmedAt, setCaughtUpAt, setAcceptedAt, setSkipSimulatedDispatch, setSeenFiles, setSeenNodes])

  useEffect(() => {
    if (!fixtureHydration) return
    const initial = deriveFiles({
      record: fixtureHydration.discovery.record, messages: [], nodes: fixtureHydration.tree, journal: fixtureHydration.journal,
      edits: {}, confirmedAt: fixtureHydration.confirmedAt, reports: [], progress: closureProgress(fixtureHydration.tree, fixtureHydration.discovery.record),
      proposal: null, acceptedAt: fixtureHydration.acceptedAt
    })
    setSeenFiles(Object.fromEntries(initial.map((file) => [file.path, file.content])))
    setSeenNodes(Object.fromEntries(fixtureHydration.tree.map((node) => [node.id, projectNodeSignature(node)])))
  }, [fixtureHydration, setSeenFiles, setSeenNodes])

  useEffect(() => {
    if (location.kind === 'map') setSeenNodes(Object.fromEntries(tree.map((node) => [node.id, projectNodeSignature(node)])))
  }, [location, tree, setSeenNodes])

  useEffect(() => {
    if (openFile) setSeenFiles((current) => ({ ...current, [openFile.path]: openFile.content }))
  }, [openFile, setSeenFiles])

  useEffect(() => {
    if (phase !== 'canvas' || proposal || acceptedAt) return
    const licensing = canPropose({ progress, reports, nodes: tree })
    if (!licensing) return
    const at = Date.now()
    const timer = window.setTimeout(() => {
      setProposal({ at, reportId: licensing.id })
      setTree((current) => [...current, {
        id: 'proposal', parent: 'root', kind: 'proposal', state: 'provisional', title: 'Completion proposed',
        summary: `Rests on report ${reports.indexOf(licensing) + 1}`, createdAt: at, updatedAt: at,
        detail: `Every gate is met and you acknowledged that state in report ${reports.indexOf(licensing) + 1}. Walk the acceptance, then accept or name the gap.`
      }])
      note(`Completion proposed. Every gate met; rests on progress report ${reports.indexOf(licensing) + 1}, which you acknowledged.`)
    }, 900)
    return () => window.clearTimeout(timer)
  }, [phase, proposal, acceptedAt, progress, reports, tree, setProposal, setTree, note])

  useEffect(() => {
    if (phase !== 'canvas' || skipSimulatedDispatch) return
    const timers: number[] = []
    let at = 0
    for (const event of buildDispatchPlan(record)) {
      at += event.delay
      timers.push(window.setTimeout(() => {
        setTree((current) => applyEvent(current, event, Date.now()))
        note(event.note)
      }, at))
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [phase, record, skipSimulatedDispatch, setTree, note])
}
