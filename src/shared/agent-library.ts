// Agents the user built and kept: a name, standing instructions, and a cycle cap. Starting one
// attaches the agent-run loop (src/shared/agent-runs.ts) to a new chat with these instructions
// as cycle 1, and the run records which library entry it came from so the library can show
// when each agent last ran. The library is small, user-owned, and never pruned.

export type SavedAgent = {
  id: string
  name: string
  /** Standing instructions: sent as cycle 1 and again after every provider thread change. */
  prompt: string
  /** Pause after this many cycles; null runs until paused. */
  maxCycles: number | null
  createdAt: number
  updatedAt: number
  /** When a run was last started from this entry; null until one is. */
  lastRunAt: number | null
  runCount: number
}

export type SavedAgentDraft = {
  name: string
  prompt: string
  maxCycles?: number | null
}

/** Fields the editor changes after saving; the id is the identity. */
export type SavedAgentPatch = {
  name?: string
  prompt?: string
  maxCycles?: number | null
}

export const SAVED_AGENT_NAME_MAX = 80

/** Seeded into an empty library on first open so the Agents dialog is never blank. */
export const BUILT_IN_AGENTS: readonly SavedAgentDraft[] = [
  {
    name: 'Repair agent',
    maxCycles: null,
    prompt: `You are the continuously running ClosedAI application repair agent. The app drives you: whenever your turn ends, it sends the next cycle automatically until I pause or stop the run from the agent strip. Do not stop because a failure is ambiguous, verification failed, or the same issue recurs. I am monitoring; the strip is the only stop signal.

Do as many cycles as you can within one turn, then end the turn with a status line; the next "Cycle N" message picks up from there. No sign-off, no "let me know if you want me to continue," and no treating a cycle report as the end of the job. If this chat's context is rotated, these instructions arrive again with the next cycle.

Each cycle:
1. closedai_app.state (workspace + ui + browser) and git status—note clean vs dirty before edits.
2. Pick one user-facing workflow (chat, layout, browser, composer, history search, tools modal, settings). Prefer flows you can exercise from this pane without messaging other live chats.
3. Exercise with closedai_app.command when a command exists; use closedai_app.ui only with fallback_reason when no command applies. Use embedded_browser.* for page content—not OS open helpers or file:// links.
4. Do not use Computer Use / cua_repl for ClosedAI's own UI—use closedai_app and ui-controls manifest ids.
5. Workspace safety: do not send_message, stop_agent, or closedai_app.agent on other panes; avoid open_chat unless a closed chat is required for the test; if you change selectedPaneId for a test, note it and return focus to this agent pane when done.
6. Stable repro → smallest focused fix, then npm run test:one on the touched module (typecheck only if shared contracts changed). Flaky repro after two honest attempts → log it and move on—do not chase the same flake all cycle.
7. End each cycle with one line: Cycle N — workflow — result — edited y/n — next.

Preserve unrelated user changes; no speculative refactors.`
  }
]

/** Trimmed, length-capped name; empty means "not saveable". */
export function cleanAgentName(name: unknown): string {
  return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, SAVED_AGENT_NAME_MAX) : ''
}

/** A whole number of at least one, or null for no cap; anything else is treated as no cap. */
export function cleanMaxCycles(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null
}

/** Shape check for an entry read back from disk; a record without a name or prompt is dropped. */
export function normalizeSavedAgent(candidate: unknown): SavedAgent | null {
  if (!candidate || typeof candidate !== 'object') return null
  const record = candidate as Record<string, unknown>
  const name = cleanAgentName(record.name)
  const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''
  if (typeof record.id !== 'string' || !record.id || !name || !prompt) return null
  const createdAt = positiveTime(record.createdAt) ?? Date.now()
  return {
    id: record.id,
    name,
    prompt,
    maxCycles: cleanMaxCycles(record.maxCycles),
    createdAt,
    updatedAt: positiveTime(record.updatedAt) ?? createdAt,
    lastRunAt: positiveTime(record.lastRunAt),
    runCount: Number.isInteger(record.runCount) && Number(record.runCount) >= 0 ? Number(record.runCount) : 0
  }
}

function positiveTime(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null
}

/** One line under a library entry: how often it ran and how long ago; "Never run" until it has. */
export function describeAgentUse(agent: Pick<SavedAgent, 'runCount' | 'lastRunAt'>, now: number): string {
  if (agent.runCount === 0 || agent.lastRunAt === null) return 'Never run'
  const times = agent.runCount === 1 ? 'Ran once' : `Ran ${agent.runCount} times`
  return `${times} · last ${relativeSpan(now - agent.lastRunAt)} ago`
}

function relativeSpan(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'moments'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days} d`
  return `${Math.floor(days / 7)} wk`
}
