import { useCallback, useEffect, useRef, useState } from 'react'

import { applyProjectMutations, type ProjectMutation } from '../../shared/project/mutations.js'
import { createDefaultProjectStoreFile, type ProjectStoreFile } from '../../shared/project/store-file.js'
import type { ProjectCanvasFixture } from './project-canvas-fixture.js'
import { fixtureStoreFile } from './project-view.js'

export type ProjectMutate = (mutations: ProjectMutation | ProjectMutation[]) => Promise<void>

export type ProjectState = {
  file: ProjectStoreFile
  mutate: ProjectMutate
  /** True when `file` mirrors `<project>/.closedai/project.json` through the main process. */
  live: boolean
}

/**
 * The workspace's single source of project state. With a project path the file is the main
 * process's store: reads come from its snapshot events and every change goes through
 * `project.mutate`, so what the user does survives a restart. Without one (fixtures, tests, the
 * standalone preview) the same mutations apply to an in-memory copy through the shared reducer,
 * so both sources produce identical next states.
 */
export function useProjectState(projectPath: string | null | undefined, fixture: ProjectCanvasFixture | null = null): ProjectState {
  const live = Boolean(projectPath) && !fixture
  const [file, setFile] = useState<ProjectStoreFile>(() => (fixture ? fixtureStoreFile(fixture) : createDefaultProjectStoreFile()))
  const canonicalPath = useRef<string | null>(null)
  const requestedPath = useRef<string | null>(null)
  requestedPath.current = live ? projectPath! : null

  useEffect(() => {
    if (!live || !projectPath) {
      canonicalPath.current = null
      return
    }
    let active = true
    void window.closedai.project.snapshot(projectPath).then((snapshot) => {
      if (!active) return
      canonicalPath.current = snapshot.projectPath
      setFile(snapshot)
    }).catch(() => {
      if (active) canonicalPath.current = null
    })
    const unsubscribe = window.closedai.project.onEvent((event) => {
      if (event.type !== 'snapshot') return
      const key = canonicalPath.current
      if (key && event.projectPath !== key) return
      canonicalPath.current = event.snapshot.projectPath
      setFile(event.snapshot)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [live, projectPath])

  const mutate = useCallback<ProjectMutate>(async (input) => {
    const mutations = Array.isArray(input) ? input : [input]
    if (!mutations.length) return
    const path = requestedPath.current
    if (path) {
      const snapshot = await window.closedai.project.mutate(path, mutations)
      canonicalPath.current = snapshot.projectPath
      setFile(snapshot)
      return
    }
    setFile((current) => applyProjectMutations(current, mutations))
  }, [])

  return { file, mutate, live }
}
