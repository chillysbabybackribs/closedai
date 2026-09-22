import type { EvidenceItem } from './direction.js'

export type TreeKind = 'root' | 'scope' | 'task' | 'research' | 'amendment' | 'proposal'
export type TreeState = 'anchored' | 'active' | 'queued' | 'complete' | 'provisional' | 'confirmed'

export type TreeNode = {
  id: string
  parent?: string
  kind: TreeKind
  state: TreeState
  title: string
  summary: string
  detail: string
  links?: EvidenceItem[]
  /** Epoch ms. Every node records when it appeared and when it last changed. */
  createdAt: number
  updatedAt: number
}
