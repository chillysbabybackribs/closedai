import { useEffect, useRef, useState } from 'react'

import type { ProjectSnapshot } from '../../shared/project/snapshot.js'

/** Load durable project state for the agent workspace; stays in sync with main-process writes. */
export function useProjectSnapshot(projectPath: string | null | undefined): ProjectSnapshot | null {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null)
  const canonicalPath = useRef<string | null>(null)
  useEffect(() => {
    if (!projectPath) {
      canonicalPath.current = null
      setSnapshot(null)
      return
    }
    let active = true
    void window.closedai.project.snapshot(projectPath).then((value) => {
      if (!active) return
      canonicalPath.current = value.projectPath
      setSnapshot(value)
    }).catch(() => {
      if (active) setSnapshot(null)
    })
    const unsubscribe = window.closedai.project.onEvent((event) => {
      if (event.type !== 'snapshot') return
      const key = canonicalPath.current
      if (key && event.projectPath !== key) return
      setSnapshot(event.snapshot)
      canonicalPath.current = event.snapshot.projectPath
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [projectPath])
  return snapshot
}
