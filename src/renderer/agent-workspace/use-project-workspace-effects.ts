import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'

import { canPropose, closureProgress, type AcknowledgedReport, type Proposal } from './project-closure.js'
import type { ProjectFile, Location } from './project-files.js'
import type { TreeNode } from './project-tree.js'
import type { ProjectMutate } from './use-project-state.js'

const AWAY_AFTER_MS = 30_000

export const projectNodeSignature = (node: TreeNode) => `${node.state}|${node.summary}`

export function useProjectWorkspaceEffects(options: {
  phase: 'intake' | 'canvas'
  shellRef: RefObject<HTMLElement | null>
  lastInteraction: RefObject<number>
  setAwayFor: (gap: number) => void
  setSeenFiles: Dispatch<SetStateAction<Record<string, string>>>
  setSeenNodes: Dispatch<SetStateAction<Record<string, string>>>
  location: Location
  tree: TreeNode[]
  files: ProjectFile[]
  openFile: { path: string; content: string } | null
  proposal: Proposal | null
  acceptedAt: number | null
  progress: ReturnType<typeof closureProgress>
  reports: AcknowledgedReport[]
  setProposal: Dispatch<SetStateAction<Proposal | null>>
  mutate: ProjectMutate
}): void {
  const {
    phase, shellRef, lastInteraction, setAwayFor, setSeenFiles, setSeenNodes, location, tree, files, openFile,
    proposal, acceptedAt, progress, reports, setProposal, mutate
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

  // What the user has seen is baselined once when the canvas first shows, so growth after that
  // is what gets flagged as changed, whether the canvas came from disk, a fixture, or Start.
  const seeded = useRef(false)
  useEffect(() => {
    if (phase !== 'canvas' || seeded.current || tree.length === 0) return
    seeded.current = true
    setSeenFiles(Object.fromEntries(files.map((file) => [file.path, file.content])))
    setSeenNodes(Object.fromEntries(tree.map((node) => [node.id, projectNodeSignature(node)])))
  }, [phase, tree, files, setSeenFiles, setSeenNodes])

  useEffect(() => {
    if (location.kind === 'map') setSeenNodes(Object.fromEntries(tree.map((node) => [node.id, projectNodeSignature(node)])))
  }, [location, tree, setSeenNodes])

  useEffect(() => {
    if (openFile) setSeenFiles((current) => ({ ...current, [openFile.path]: openFile.content }))
  }, [openFile, setSeenFiles])

  // Prototype closure: once every gate is met and acknowledged, the workspace itself proposes
  // completion. Slice D moves this to the coordinator; until then it is the only timer left.
  useEffect(() => {
    if (phase !== 'canvas' || proposal || acceptedAt) return
    const licensing = canPropose({ progress, reports, nodes: tree })
    if (!licensing) return
    const at = Date.now()
    const index = reports.indexOf(licensing) + 1
    const timer = window.setTimeout(() => {
      setProposal({ at, reportId: licensing.id })
      void mutate({
        type: 'tree',
        events: [{ add: {
          id: 'proposal', parent: 'root', kind: 'proposal', state: 'provisional', title: 'Completion proposed',
          summary: `Rests on report ${index}`,
          detail: `Every gate is met and you acknowledged that state in report ${index}. Walk the acceptance, then accept or name the gap.`
        } }],
        note: `Completion proposed. Every gate met; rests on progress report ${index}, which you acknowledged.`
      })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [phase, proposal, acceptedAt, progress, reports, tree, setProposal, mutate])
}
