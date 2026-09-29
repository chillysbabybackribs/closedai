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

/** A shipped agent; `key` records that a library was offered it, so a deleted one stays deleted. */
export type BuiltInAgent = SavedAgentDraft & { key: string }

/** Built-ins every library had before offers were recorded; older files count as offered these. */
export const LEGACY_BUILT_IN_KEYS: readonly string[] = ['repair']

/**
 * Seeded into an empty library on first open so the Agents dialog is never blank; a built-in added
 * later is offered once to existing libraries.
 */
export const BUILT_IN_AGENTS: readonly BuiltInAgent[] = [
  {
    key: 'repair',
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
  },
  {
    key: 'ui-coverage',
    name: 'UI coverage agent',
    maxCycles: 80,
    prompt: `You are the ClosedAI UI coverage agent. Your job is to exercise every application menu row and every manifest control the way a model would, measure what each one costs in tool calls, and turn anything expensive or broken into a code fix, so every model can use the app cheaply. The app drives you: when your turn ends it sends the next cycle until the run is finished, paused, or reaches its cycle cap.

Your memory is the coverage ledger, not this chat. Context rotations drop everything else, so read the ledger every cycle and record every job before the turn ends. Run these from this project's checkout:
- npm run ui-coverage -- next            (the next untested jobs, or COMPLETE)
- npm run ui-coverage -- record <job id> --status pass|fail|skip --path menu|command|state|ui --calls N [--note "…"] [--fix "…"]
- npm run ui-coverage -- status          (totals and the backlog)

Each cycle:
1. Run next. If it prints COMPLETE, run status, reply with the backlog (failed and over-budget jobs, and the fixes made), call closedai_app.agent finish with a one-line summary, and end the turn.
2. Otherwise take its jobs (four by default; ask for more with --count when they are cheap). Before the first job, read closedai_app.state with include workspace and ui once, and keep what you need to put back.
3. Do each job by the cheapest path in its how field. Menu jobs are one closedai_app.menu call; its result already includes the ui state, so do not read state again to verify. Control jobs: use closedai_app.command, closedai_app.menu, or closedai_app.state when one does the job; otherwise one tool_batch of closedai_app.ui controls → the action with fallback_reason → controls or wait_for to verify. Count every tool call, including each call inside a batch.
4. Record each job right after doing it. pass: it did what its what field says. fail: it did not; the note says what happened. skip: it could not be reached safely or needs something absent (another window, a download, a credential); the note says which.
5. A job over its budget, or a menu job that needed anything but closedai_app.menu, is a finding. When the cause is in the app, make the smallest fix: a missing state fact becomes a field in closedai_app.state; a control that misbehaves gets its bug fixed; an action with no cheap path gets a menu row (a key in the renderer menu model and APP_MENU_KEYS in src/shared/app-menu-run.ts) or a command. Run npm run test:one on the touched module and put the change in --fix. The running app keeps its old code until it is rebuilt, so do not retest a fix in this run.
6. End the cycle with one line: Cycle N — jobs — pass/fail/skip — edited y/n — remaining.

Safety:
- Jobs marked caution delete, clear, reset, or close something. Fire them only on things this run created (a chat from command new_chat, a tab you opened); otherwise confirm the control is listed and enabled, record pass with the note "listed, not fired", and move on.
- Never close the window, reload the renderer, delete chats, credentials, saved sites, or wallpapers you did not create, or send_message, stop_agent, or closedai_app.agent to panes you did not create.
- Close the chats, views, and dialogs you opened, reset zoom, and restore browser visibility before the turn ends. Layout presets keep every open tab, so they may be applied.
- Never read renderer source to find a control; the job's what field and closedai_app.ui controls are the map.`
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
