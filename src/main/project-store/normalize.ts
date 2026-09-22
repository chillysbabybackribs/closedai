import { CHAT_PROVIDERS } from '../../shared/chat-providers.js'
import { type CoordinatorBinding, type HiveConfig } from '../../shared/project/coordinator.js'
import { PROJECT_STORE_VERSION, type ProjectStoreFile } from '../../shared/project/store-file.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse on-disk JSON into a store file, or null when the shape is unusable. */
export function normalizeProjectStoreFile(raw: unknown): ProjectStoreFile | null {
  if (!isRecord(raw) || raw.version !== PROJECT_STORE_VERSION) return null
  const direction = isRecord(raw.direction) ? raw.direction : null
  if (!direction || typeof direction.idea !== 'string') return null
  const parsedHive = parseHive(raw.hive)
  if (!parsedHive) return null
  const phase = raw.phase
  if (phase !== 'intake' && phase !== 'confirm' && phase !== 'building' && phase !== 'closing' && phase !== 'complete') return null
  return {
    version: PROJECT_STORE_VERSION,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    phase,
    direction: {
      idea: direction.idea,
      user: typeof direction.user === 'string' ? direction.user : direction.user === null ? null : null,
      journey: typeof direction.journey === 'string' ? direction.journey : direction.journey === null ? null : null,
      boundaries: typeof direction.boundaries === 'string' ? direction.boundaries : direction.boundaries === null ? null : null,
      evidence: Array.isArray(direction.evidence) ? direction.evidence.filter(isRecord).map((item, index) => ({
        id: typeof item.id === 'string' ? item.id : `ev-${index}`,
        label: typeof item.label === 'string' ? item.label : '',
        url: typeof item.url === 'string' ? item.url : '',
        informs: typeof item.informs === 'string' ? item.informs : ''
      })) : [],
      unknowns: Array.isArray(direction.unknowns) ? direction.unknowns.filter((entry): entry is string => typeof entry === 'string') : [],
      refinements: Array.isArray(direction.refinements) ? direction.refinements.filter((entry): entry is string => typeof entry === 'string') : []
    },
    discoveryAsking: raw.discoveryAsking === null || typeof raw.discoveryAsking === 'string'
      ? raw.discoveryAsking as ProjectStoreFile['discoveryAsking']
      : 'idea',
    coordinator: parseCoordinator(raw.coordinator),
    hive: parsedHive,
    startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : null,
    acceptedAt: typeof raw.acceptedAt === 'number' ? raw.acceptedAt : null,
    caughtUpAt: typeof raw.caughtUpAt === 'number' ? raw.caughtUpAt : 0,
    tree: Array.isArray(raw.tree) ? raw.tree.filter(isRecord).map((node, index) => ({
      id: typeof node.id === 'string' ? node.id : `node-${index}`,
      parent: typeof node.parent === 'string' ? node.parent : undefined,
      kind: node.kind === 'root' || node.kind === 'scope' || node.kind === 'task' || node.kind === 'research'
        || node.kind === 'amendment' || node.kind === 'proposal' ? node.kind : 'task',
      state: node.state === 'anchored' || node.state === 'active' || node.state === 'queued' || node.state === 'complete'
        || node.state === 'provisional' || node.state === 'confirmed' ? node.state : 'queued',
      title: typeof node.title === 'string' ? node.title : '',
      summary: typeof node.summary === 'string' ? node.summary : '',
      detail: typeof node.detail === 'string' ? node.detail : '',
      createdAt: typeof node.createdAt === 'number' ? node.createdAt : Date.now(),
      updatedAt: typeof node.updatedAt === 'number' ? node.updatedAt : Date.now()
    })) : [],
    journal: Array.isArray(raw.journal) ? raw.journal.filter(isRecord).map((line, index) => ({
      id: typeof line.id === 'number' ? line.id : index + 1,
      at: typeof line.at === 'number' ? line.at : Date.now(),
      text: typeof line.text === 'string' ? line.text : ''
    })) : []
  }
}

function parseCoordinator(raw: unknown): CoordinatorBinding | null {
  if (!isRecord(raw)) return null
  const provider = raw.provider
  if (typeof provider !== 'string' || !CHAT_PROVIDERS.includes(provider as CoordinatorBinding['provider'])) return null
  if (typeof raw.modelId !== 'string') return null
  return {
    provider: provider as CoordinatorBinding['provider'],
    modelId: raw.modelId,
    reasoningEffort: typeof raw.reasoningEffort === 'string' ? raw.reasoningEffort : null,
    threadId: typeof raw.threadId === 'string' ? raw.threadId : null
  }
}

function parseHive(raw: unknown): HiveConfig | null {
  if (!isRecord(raw) || raw.version !== 1) return null
  const workers = isRecord(raw.workers) ? raw.workers : null
  const dispatch = isRecord(raw.dispatch) ? raw.dispatch : null
  if (!workers || !dispatch || dispatch.mode !== 'rolling') return null
  const roles = Array.isArray(workers.roles) ? workers.roles.filter(isRecord).map((role, index) => ({
    id: typeof role.id === 'string' ? role.id : `role-${index}`,
    model: typeof role.model === 'string' ? role.model : 'auto',
    tools: Array.isArray(role.tools) ? role.tools.filter((entry): entry is string => typeof entry === 'string') : []
  })) : []
  const defaultProvider = workers.defaultProvider
  return {
    version: 1,
    workers: {
      maxConcurrent: typeof workers.maxConcurrent === 'number' ? workers.maxConcurrent : 4,
      defaultProvider: defaultProvider === 'auto'
        ? 'auto'
        : typeof defaultProvider === 'string' && CHAT_PROVIDERS.includes(defaultProvider as typeof CHAT_PROVIDERS[number])
          ? defaultProvider as typeof CHAT_PROVIDERS[number]
          : 'auto',
      roles
    },
    dispatch: { mode: 'rolling', replanAfterAmendment: dispatch.replanAfterAmendment !== false }
  }
}

