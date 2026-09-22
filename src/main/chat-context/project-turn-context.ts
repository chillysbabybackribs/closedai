import { parseProjectPeerRole, type ProjectPeerRole } from '../../shared/project-peer-ids.js'
import type { AdditionalContext } from './turn-context.js'
import { PROJECT_COORDINATOR_INSTRUCTIONS } from './project-coordinator-instructions.js'
import { PROJECT_INTAKE_INSTRUCTIONS } from './project-intake-instructions.js'

const CONTEXT_NAMES: Record<ProjectPeerRole, string> = {
  intake: 'closedai.project.intake',
  coordinator: 'closedai.project.coordinator'
}

export function projectRoleAdditionalContext(paneId: string | null | undefined): AdditionalContext | undefined {
  const role = paneId ? parseProjectPeerRole(paneId) : null
  if (!role) return undefined
  return {
    [CONTEXT_NAMES[role]]: {
      kind: 'application',
      value: role === 'intake' ? PROJECT_INTAKE_INSTRUCTIONS : PROJECT_COORDINATOR_INSTRUCTIONS
    }
  }
}

export function mergeProjectRoleContext(paneId: string | null | undefined, base: AdditionalContext | undefined): AdditionalContext | undefined {
  const project = projectRoleAdditionalContext(paneId)
  if (!project) return base
  const merged = { ...(base ?? {}), ...project }
  return Object.keys(merged).length ? merged : undefined
}
