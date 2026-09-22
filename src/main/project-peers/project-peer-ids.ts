import { createHash } from 'node:crypto'

import type { ProjectPeerRole } from '../../shared/project-peer-ids.js'

export function projectPeerChatId(projectPath: string, role: ProjectPeerRole): string {
  const hash = createHash('sha256').update(`${role}\0${projectPath}`).digest('hex').slice(0, 20)
  return `closedai:project-${role}-${hash}`
}
