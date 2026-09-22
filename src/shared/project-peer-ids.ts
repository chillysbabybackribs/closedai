export type ProjectPeerRole = 'intake' | 'coordinator'

export const PROJECT_PEER_TITLES: Record<ProjectPeerRole, string> = {
  intake: 'Project · Intake',
  coordinator: 'Project · Coordinator'
}

export function parseProjectPeerRole(paneId: string): ProjectPeerRole | null {
  if (paneId.startsWith('closedai:project-intake-')) return 'intake'
  if (paneId.startsWith('closedai:project-coordinator-')) return 'coordinator'
  return null
}

export function isProjectPeerChatId(paneId: string): boolean {
  return parseProjectPeerRole(paneId) !== null
}
