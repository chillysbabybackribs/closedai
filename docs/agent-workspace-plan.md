# Agent workspace: development plan

Status: working plan, 2026-09-22. This is the one document a pane reads before touching the agent
workspace. It records what is real today, what v1 must do and what v2 may add, and how parallel
panes stay out of each other's way. Update it when a piece lands. The
[blueprint](adaptive-multi-agent-development-blueprint.md) is the target shape; this plan is the path.

## Product contract: autonomous hive (owner, 2026-09-22)

The agent workspace is an **agent hive that runs on its own** after the user confirms direction.
The user **may** monitor and intervene at any time; they must **not** have to babysit the build.

| Default (hive) | Optional (user) | Not the product |
| --- | --- | --- |
| After Start, work is planned into `project.json` and **keeps moving** under `hive.dispatch` (rolling dispatch, bounded concurrency in `HiveConfig`) | Open the map, catch up, read journal/files, send direction or constraints | Per-task “continue”, nudging the coordinator after every completion |
| Workers run **headless**; status and outcomes land on tree nodes and journal | Pause, stop, or amend; direction becomes a store amendment and replan | Opening each task as a **main-layout chat tab** the user must follow |
| Shared store is truth; the workspace pane is the **cockpit** | Drill into a node or file; reopen history if needed | The chat tab strip as the orchestration surface |

**Babysitting** means: queued tasks sit idle until a human or a one-shot coordinator turn does
something; workers appear outside the workspace; or progress only advances when the user remembers
to message the coordinator. That is a failure mode, not a v1 limitation to accept.

The store already declares a hive (`hive.workers`, `hive.dispatch.mode: 'rolling'` in
`src/shared/project/coordinator.ts`). The gap is a **main-process consumer** that watches the store
and spawns/sends/briefs workers — not more coordinator prose.

## Drift: prompt-driven v1 (acknowledged 2026-09-22)

A shortcut landed: the coordinator model calls `closedai_app.command new_chat` and `send_message`,
then its turn ends. Nothing in the app guarantees the next queued task runs. That path was useful to
prove `closedai_project.mutate` and one worker completion, but it **contradicts the product contract**
above and caused the “tab outside the workspace / everything stopped queued” experience.

**Do not extend** that pattern (more instructions, background flags only, UI polish on Start).
**Do** implement the smallest **hive runner** that reads `project.json`, respects `HiveConfig`, and
loops: dispatch → worker completes → dispatch next, with user direction as amendments only.

## Why this document exists

On 2026-09-21/22 seven panes edited the workspace at once. Two edit paths existed (the removed
`dev:web` preview and the real Electron pane), panes assumed hot reload the running app does not
have, and nobody had written down which parts of the pane were live and which were a timed
prototype. Work was redone, dropped, and re-added. The fix is not more caution; it is a shared,
current statement of state and scope.

## How this is being built

The owner's intent, stated 2026-09-22: build a little at a time, enough to test and modify, and do
not build any piece the way the finished product would have it. Later phases will change what
earlier pieces need, so a piece built "correctly" now is likely to be rebuilt anyway.

What that means for a pane working here:

- **The blueprint is direction, not a spec.** Do not implement a blueprint section because it is
  written down. Implement the smallest thing that lets the owner try the next step in the app.
- **Prototype paths are allowed** when they are labeled as such in code and docs, sit behind a
  fixture or flag, and never pretend to be runtime behavior on the live path.
- **Prefer the crude version that runs** over the designed version that does not. A plain patch
  verb the owner can exercise today beats an event-sourced store that lands next week.
- **Do not add structure for a phase that has not arrived.** No leases before two writers race; no
  branch isolation before headless workers exist. **Exception:** a minimal **dispatch consumer**
  for `hive.dispatch.mode: 'rolling'` is required for the product to exist at all — not a “v2
  luxury.”
- **Each slice ends with the owner trying it** in the running Electron app. If they cannot, the
  slice is not done.

## What is real today

Verified in source on 2026-09-22.

| Piece | Status | Where |
| --- | --- | --- |
| Reserved layout pane, show/hide, full view, drag | Live | `src/renderer/chat-layout/`, `src/renderer/agent-workspace/agent-workspace-pane.tsx` |
| Detached coordinator chat on the normal provider pipeline | Live | `chat.newDetachedThread`, `src/main/peer-detached.ts` |
| Coordinator prompt (intake pillars only) | Live | `src/main/chat-context/agent-workspace-instructions.ts` |
| Durable store `<project>/.closedai/project.json`, atomic debounced writes, self-ignoring dir | Live | `src/main/project-store/` |
| Store shape: phase, direction, coordinator binding, hive config, tree, journal | Defined | `src/shared/project/` |
| Read path: `project:snapshot` invoke plus `project:event` snapshot push | Live | `src/main/project-ipc.ts`, `project-hub.ts`, preload `project.*` |
| Write path: `project:mutate` carrying `ProjectMutation[]`, applied by the shared reducer | Live (slice A) | `src/shared/project/mutations.ts`, `project-store.ts` `mutate`, `project-ipc.ts` |
| Workspace renders the store file; live source over IPC, in-memory source for fixtures and tests | Live (slice A) | `use-project-state.ts`, `project-view.ts` |
| Start building, journal, amendments, catch-up, accept, reopen persist and survive a relaunch | Live (slice A) | `project-workspace.tsx` issues mutations only |
| Restart control, `closedai_ui.capture` `agent_workspace` | Live | `layout.agent-restart`, `src/main/tools/capture/agent-workspace.ts` |
| Model tool over the store: `closedai_project` `snapshot` and `mutate` | Live (v1) | `src/main/tools/project/`; resolves the calling chat's project, or `project_path` |
| Start sends the coordinator a kickoff message; coordinator plans tasks into the store | Live (v1) | `project-workspace.tsx` `start`, building-phase paragraphs in `agent-workspace-instructions.ts` |
| Worker chats | Misaligned interim | Prompt-driven `new_chat` / `send_message`; optional `background: true`. **Replace** with app-spawned headless workers under `HiveConfig` |
| Hive dispatch consumer | **Not built — blocks product** | Should read store + `hive`, spawn workers, continue on task `complete` without user babysitting |
| Direction record filled from the transcript | Prototype | `syncDiscoveryWithItems` maps user message N to pillar N and invents unknowns and evidence; persisted through `direction` mutations so Start is reachable |
| User direction during building | Prototype | The pane turns it into an amendment node itself (`amendTree`, whole-tree replace) and also forwards it to the coordinator |
| Acknowledged reports, open completion proposal | Prototype | Local React state and a 900 ms proposal timer |
| Claims, leases, dispatch engine, `HiveConfig` consumer | Not built | Deliberately; see v2 |

The consequence: one real run is now possible end to end. Whether it works is the next thing to
find out, and that finding decides what v2 contains.

## v1: one functional pipeline

Decided by the owner 2026-09-22, replacing the layer-by-layer slices B, C, and D that were here
before: build one working pipeline out of basic moving parts first, then optimize and tune. The
earlier order built infrastructure (store, then tool namespace, then claims) and never produced the
thing the owner wanted to see, which is an idea going in and real work coming out. Every remaining
piece is pulled by a failure observed in a real run, not by the blueprint.

The **hive pass condition** (what “working” means after the drift correction):

1. Type an idea into the agent workspace and answer four questions.
2. Press Start building.
3. The hive writes one to three tasks under the root; the canvas shows them.
4. **Without further user action**, the hive dispatches the first task to a headless worker in the
   project directory; **no main-layout chat tab** opens for that work.
5. When the task completes in the store, the hive **automatically** dispatches the next queued
   task (rolling, up to `hive.workers.maxConcurrent`) until none remain or the user stops the hive.
6. The user can walk away, then return to the same pane and see tree + journal progress; optional
   direction amends the store and replans — not required to unblock queued work.

What v1 is made of, all landed 2026-09-22:

- `closedai_project.snapshot` and `closedai_project.mutate` in `src/main/tools/project/`. `mutate`
  carries the same `ProjectMutation[]` the pane sends; `mutation-parser.ts` turns untrusted JSON
  into typed mutations or a list of problems, refuses the whole batch on any problem, and never
  accepts `reset`, `coordinator`, or whole-tree `replace` from a model. The project is resolved from
  the caller's chat record (`projectPath ?? cwd`) unless `project_path` is passed, which is how a
  worker briefed by the coordinator writes into the right store.
- Start writes the `start` mutation, then sends the coordinator chat a kickoff message through the
  composer bridge (`START_MESSAGE` in `project-workspace.tsx`).
- Three building-phase paragraphs in `agent-workspace-instructions.ts`: read the snapshot, plan one
  to three small tasks, open a worker with `closedai_app.command new_chat` (`background: true`), brief it with
  `send_message` (`await_turn` false) including the project path and the completion instruction,
  mark the task active, never do the work itself, reply in three sentences.
- Workers are ordinary chats with every tool. Nothing distinguishes them but the message they got.

Known limits, accepted for v1: `new_chat` inherits the selected pane's project, not the
coordinator's, so the owner keeps the workspace on the same project as the selected chat; the
pane's own amendment writer can race a coordinator write in the same second; nothing stops the
coordinator from dispatching a second task before the first completes except its instructions.

## Next: hive runner (required)

Smallest implementation that satisfies the product contract:

1. **Dispatch consumer** in main: on store changes (and on Start), select `queued` tasks under rolling
   rules, spawn headless worker runtimes (reuse `newWorkerPeer` / `agentWorker`), brief with task +
   `project_path`, track `active` on the node.
2. **Completion hook:** when a worker marks a task `complete`, consumer schedules the next dispatch
   without a user or coordinator message.
3. **Coordinator role narrows:** intake + initial plan (tasks into store) + amendments; **not** the
   only thing that can start workers.
4. **Enforce:** agent-workspace coordinators cannot create visible layout tabs for hive work.

Further tuning after the hive runs without babysitting:

- **Coordinator writes the record** (`direction` mutation during intake, delete
  `syncDiscoveryWithItems`) if the positional mapping records wrong answers in practice.
- **Claims and leases** (`owner`, `leaseUntil` on `TreeNode`, atomic claim in the hub) if two
  workers ever touch one task, or a worker dies holding one.
- **Store-backed reports and proposal** (slice D as previously written) if the local state loses
  something the owner cared about across a relaunch.
- **Pane amendment through the coordinator** instead of `amendTree`'s replace if a user message
  clobbers a coordinator write.
- **App-spawned workers from `HiveConfig`** if the prompt-driven `new_chat` path proves too loose
  to steer, or the owner wants worker models chosen per role.
- **Coordinator binding** if a restart needs to tell whose record it is looking at.

## Landed slices

Kept for the record; each entry says what it changed and how it was verified.

### Slice A: write path — landed 2026-09-22

Goal: what the user does in the pane survives a restart, and no state lives only in React.

What landed:

- One invoke, `project:mutate(projectPath, ProjectMutation[])`, applied in order as one store
  change and one disk write. Verbs: `direction`, `start`, `tree` (add, update, remove, replace
  events), `phase`, `caughtUp`, `journal`, `coordinator`. Each may carry a journal `note`. The
  reducer is `applyProjectMutations` in `src/shared/project/mutations.ts`; the store and the
  renderer's in-memory source both call it.
- `useProjectState(projectPath, fixture)` is the component's only state source. With a path it
  mirrors the main-process store; without one it applies the same mutations in memory. The
  component derives everything it shows through `projectView(file)`.
- The dispatch timers and hydration effects are gone from the live path. `buildDispatchPlan` now
  only fills the canvas fixture. The Start row shows in the embedded pane once the record is ready,
  so the live pane can reach the canvas.
- Store file shape unchanged; version 1 files read as before.

Verification done: typecheck, 31 tests across `src/shared/project`, `src/main/project-store`, and
`src/renderer/agent-workspace`, hygiene, and a production build.

Tried in the running app on 2026-09-22 (Cursor coordinator, `closedai` checkout as the project):
four intake answers each landed in `project.json` as the next pillar; Start wrote `phase: building`,
the root node, and the start note; a building-phase message became `amendment-1` plus a journal
line; hiding and re-showing the pane rehydrated all of it from the store. Found and fixed the same
day: the building layout filled only the top half of the embedded pane because
`.project-workstation` had no flex rule in the embedded flex column (`pane.css`). Still to do by the
owner: quit, relaunch, reopen the pane, and see the same record, root node, amendment, and journal.
Known and expected: `coordinator` stays `null` and evidence is fixture text until slice B.
Found after the owner's relaunch: the restart control only detached a new coordinator chat, so the
pane rehydrated the building-phase file and there was no way back to intake. Fixed the same day
with a `reset` mutation (blank file, hive config kept) that the restart control issues before
closing the chat.

### Intake voice — landed 2026-09-22

Owner direction after the first live intake: the coordinator was writing spec essays with tables and
five sub-questions per pillar. A non-technical person and a senior engineer must get the same
experience: type an idea, answer a few short questions that clearly matter, press Start. The prompt
in `agent-workspace-instructions.ts` now says one pillar and one question per turn, at most five
plain sentences, no code formatting or lists, and one headless `search.query` lookup before the
first question so the question rests on what already exists. The coordinator never drives the
visible browser and never touches files during intake. Slice B keeps this voice; it changes only
who writes the record.

### v1 pipeline — landed 2026-09-22

See "v1: one functional pipeline" above for what it is made of. Verification done: typecheck;
6 new tests in `src/main/tools/project/project.test.ts` (path resolution, a coordinator plan
followed by a worker completion on one in-memory store, batch refusal with per-fault paths, parser
defaults and rejections, registry names); prompt, catalog, schema-import, registry, and view tests
still green; hygiene; production build. Not yet done: the owner's real run against the pass
condition above. The former slices B (coordinator-written record), C (claims and app-spawned
workers), and D (store-backed closure) are folded into the v2 candidate list, each waiting for the
failure that would justify it.

## Working rules for parallel panes

- **One pane per slice.** Before starting, read this file and `git log --since=1.day -- src/renderer/agent-workspace src/main/project-store src/shared/project`.
  If another pane touched those paths in the last hour, coordinate through the user first.
- **Ownership by path.** Store and pane: `src/main/project-store/`, `src/main/project-ipc.ts`,
  preload `project.*`, `src/renderer/agent-workspace/`. Model side: `src/main/tools/project/`,
  `src/main/chat-context/agent-workspace-instructions.ts`. A v2 item that touches both sides is
  one pane's job, not two.
- **The running app does not hot-reload.** The user runs `npm run preview` from `out/`. A renderer
  change is visible only after `npm run build && npm run preview`. Say so in the report instead of
  claiming a visual check you did not do.
- **Fixtures are not evidence.** `project-canvas-fixture.ts` and any pre-seeded canvas prove the
  view renders, not that the runtime works.
- **Name the prototype.** Until a slice lands, docs and descriptions call the canvas a simulation.
  Do not describe blueprint behavior as current.
- **Update this file and `docs/application.md` in the same change** that lands a slice. Regenerate
  the workspace index when files are added or IPC ownership changes.
- **Do not raise caps or add exceptions** to work around a large file. Shrink a component by
  moving state or logic out, not by extracting a child that takes forty props.

## Decisions the owner has made

1. **Store format (2026-09-22).** JSON store as the source; Markdown is a projection.
2. **Build order (2026-09-22).** One functional v1 pipeline from basic moving parts, then v2
   optimize and tune. Infrastructure is added when a real run shows it is missing, not before.
3. **Workers (2026-09-22, v1).** Ordinary chats the coordinator opens by prompt. App-spawned
   workers from `HiveConfig` are a v2 candidate if the prompt path proves too loose.
4. **Coordinator scope (2026-09-22, v1).** Intake plus planning and dispatch. Writing the direction
   record itself is a v2 candidate.

## Out of scope for this phase

Background execution while the app is closed, worktree or container isolation, merge queues,
quality observers, multiple coordinators, and the aggregated command surface. Each is a later
blueprint stage and depends on stage 1 working on a real project first.
