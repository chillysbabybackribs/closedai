import { useEffect, useState } from 'react'

import type { ProjectPeersSnapshot } from '../../shared/project-peers.js'

export function useProjectPeers(options: {
  projectPath: string | null | undefined
  modelId: string | null | undefined
  reasoningEffort: string | null | undefined
  enabled: boolean
}): ProjectPeersSnapshot | null {
  const { projectPath, modelId, reasoningEffort, enabled } = options
  const [peers, setPeers] = useState<ProjectPeersSnapshot | null>(null)
  useEffect(() => {
    if (!enabled || !projectPath) {
      setPeers(null)
      return
    }
    let active = true
    void window.closedai.project.ensurePeers(projectPath, modelId ?? null, reasoningEffort ?? null).then((value) => {
      if (active) setPeers(value)
    }).catch(() => {
      if (active) setPeers(null)
    })
    return () => { active = false }
  }, [enabled, projectPath, modelId, reasoningEffort])
  return peers
}
