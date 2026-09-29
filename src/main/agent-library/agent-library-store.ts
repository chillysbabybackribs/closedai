import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import {
  BUILT_IN_AGENTS, LEGACY_BUILT_IN_KEYS, cleanAgentName, cleanMaxCycles, normalizeSavedAgent,
  type SavedAgent, type SavedAgentDraft, type SavedAgentPatch
} from '../../shared/agent-library.js'
import { AGENT_RUN_MAX_PROMPT_CHARS } from '../../shared/agent-runs.js'
import { writeAtomic } from '../atomic-write.js'

// The agents the user built and kept, one small file beside the other user stores. A missing
// file is a first open and gets the built-in entries; a present file, even an emptied one, is
// the user's and is never re-seeded; a built-in shipped later is offered to it once, and `offered`
// remembers that so deleting it sticks. Same atomic-write + debounce discipline as SavedSitesStore.

type PersistedAgentLibrary = {
  version: 1
  agents: SavedAgent[]
  /** Built-in keys this library has been offered. */
  offered: string[]
}

const WRITE_DEBOUNCE_MS = 250

export class AgentLibraryStore extends EventEmitter {
  private state: PersistedAgentLibrary
  private writeQueue: Promise<void> = Promise.resolve()
  private writeTimer: ReturnType<typeof setTimeout> | null = null

  private constructor(
    private readonly filePath: string,
    state: PersistedAgentLibrary,
    private readonly now: () => number
  ) {
    super()
    this.state = state
  }

  static async open(filePath: string, now: () => number = () => Date.now()): Promise<AgentLibraryStore> {
    const state = await readAgentLibrary(filePath) ?? { version: 1, agents: [], offered: [] }
    const store = new AgentLibraryStore(filePath, state, now)
    const fresh = BUILT_IN_AGENTS.filter((draft) => !state.offered.includes(draft.key))
    if (fresh.length === 0) return store
    for (const draft of fresh) {
      store.insert(draft)
      state.offered.push(draft.key)
    }
    await store.flush()
    return store
  }

  /** Most recently used first, so the one the user keeps reaching for stays at the top. */
  list(): SavedAgent[] {
    return [...this.state.agents]
      .sort((a, b) => (b.lastRunAt ?? b.updatedAt) - (a.lastRunAt ?? a.updatedAt))
      .map((agent) => ({ ...agent }))
  }

  get(id: string): SavedAgent | null {
    const agent = this.state.agents.find((candidate) => candidate.id === id)
    return agent ? { ...agent } : null
  }

  save(draft: SavedAgentDraft): SavedAgent {
    const agent = this.insert(draft)
    this.changed()
    return { ...agent }
  }

  update(id: string, patch: SavedAgentPatch): SavedAgent | null {
    const agent = this.state.agents.find((candidate) => candidate.id === id)
    if (!agent) return null
    if (patch.name !== undefined) agent.name = requireName(patch.name)
    if (patch.prompt !== undefined) agent.prompt = requirePrompt(patch.prompt)
    if (patch.maxCycles !== undefined) agent.maxCycles = cleanMaxCycles(patch.maxCycles)
    agent.updatedAt = this.now()
    this.changed()
    return { ...agent }
  }

  remove(id: string): void {
    const before = this.state.agents.length
    this.state.agents = this.state.agents.filter((agent) => agent.id !== id)
    if (this.state.agents.length !== before) this.changed()
  }

  /** A run started from this entry; unknown ids (a deleted agent) are ignored. */
  recordRun(id: string): void {
    const agent = this.state.agents.find((candidate) => candidate.id === id)
    if (!agent) return
    agent.lastRunAt = this.now()
    agent.runCount += 1
    this.changed()
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    const snapshot = JSON.stringify(this.state)
    this.writeQueue = this.writeQueue.then(() => writeAtomic(this.filePath, snapshot))
    await this.writeQueue
  }

  private insert(draft: SavedAgentDraft): SavedAgent {
    const at = this.now()
    const agent: SavedAgent = {
      id: randomUUID(),
      name: requireName(draft.name),
      prompt: requirePrompt(draft.prompt),
      maxCycles: cleanMaxCycles(draft.maxCycles),
      createdAt: at,
      updatedAt: at,
      lastRunAt: null,
      runCount: 0
    }
    this.state.agents.push(agent)
    return agent
  }

  private changed(): void {
    this.scheduleWrite()
    this.emit('changed', this.list())
  }

  private scheduleWrite(): void {
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      void this.flush()
    }, WRITE_DEBOUNCE_MS)
  }
}

function requireName(name: unknown): string {
  const clean = cleanAgentName(name)
  if (!clean) throw new Error('Give the agent a name before saving it')
  return clean
}

function requirePrompt(prompt: unknown): string {
  const clean = typeof prompt === 'string' ? prompt.trim() : ''
  if (!clean) throw new Error('Give the agent standing instructions before saving it')
  if (clean.length > AGENT_RUN_MAX_PROMPT_CHARS) throw new Error(`Agent instructions are limited to ${AGENT_RUN_MAX_PROMPT_CHARS} characters`)
  return clean
}

type MaybePersisted = { version?: unknown; agents?: unknown; offered?: unknown }

async function readAgentLibrary(filePath: string): Promise<PersistedAgentLibrary | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as MaybePersisted
    if (parsed.version !== 1 || !Array.isArray(parsed.agents)) return null
    const agents = parsed.agents.map(normalizeSavedAgent).filter((agent): agent is SavedAgent => agent !== null)
    const offered = Array.isArray(parsed.offered)
      ? parsed.offered.filter((key): key is string => typeof key === 'string')
      : [...LEGACY_BUILT_IN_KEYS]
    return { version: 1, agents, offered }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code !== 'ENOENT') console.warn('Unable to read the agent library; starting clean', error)
    return null
  }
}
