# Agent workspace: development plan

Status: working plan, 2026-09-22. This is the one document a pane reads before touching the agent
workspace. It records what is real today, what the next slices are, and how parallel panes stay out
of each other's way. Update it when a slice lands. The
[blueprint](adaptive-multi-agent-development-blueprint.md) is the target shape; this plan is the path.

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
- **Do not add structure for a phase that has not arrived.** No leases before there are two
  writers, no observers before there are tasks, no branch isolation before there is dispatch.
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
| Worker chats | Live (v1), by prompt | Ordinary chats the coordinator opens with `closedai_app.command new_chat` and briefs with `send_message`; they record completion with `closedai_project.mutate` |
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

The v1 pass condition, checked by the owner in the running app:

1. Type an idea into the agent workspace and answer four questions.
2. Press Start building.
3. The coordinator writes one to three tasks under the root and the canvas shows them.
4. A new chat pane opens, receives one task, and does it in the project directory.
5. That chat marks the task complete through the tool, and the canvas and journal show it without
   anyone touching the pane.

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
  to three small tasks, open a worker with `closedai_app.command new_chat`, brief it with
  `send_message` (`await_turn` false) including the project path and the completion instruction,
  mark the task active, never do the work itself, reply in three sentences.
- Workers are ordinary chats with every tool. Nothing distinguishes them but the message they got.

Known limits, accepted for v1: `new_chat` inherits the selected pane's project, not the
coordinator's, so the owner keeps the workspace on the same project as the selected chat; the
pane's own amendment writer can race a coordinator write in the same second; nothing stops the
coordinator from dispatching a second task before the first completes except its instructions.

## v2: optimize and tune

Only after a v1 run has been observed. Candidates, each tied to the failure that would justify it:

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

### Slice B: the coordinator owns the record

Goal: the direction record is what the model decided, with its evidence.

- Add a `closedai_project` tool namespace under `src/main/tools/` with read (`snapshot`, with
  projection) and write verbs (`update_direction`, `set_phase`, `add_node`, `update_node`,
  `journal`). Same shared contract for every provider lane; adapters only translate.
- Extend `agent-workspace-instructions.ts`: after each pillar is clarified, record it with the
  tool; attach evidence URLs from search; write unknowns as it finds them; do not narrate a record
  it did not write.
- Bind the coordinator thread into `coordinator` on first turn so a restart can tell whether the
  record belongs to the current chat.
- Delete `syncDiscoveryWithItems` and the fixture `RESEARCH` evidence from the live path.

Verification: run intake in the app with one provider; the record in `project.json` matches what
the model said, and the tool calls are visible in the transcript. Provider attach probe confirms the
namespace reaches each lane.

### Slice C: real dispatch and claims

Goal: two chats read and update the same project state; this is the blueprint's foundational
interaction.

- "Start building" asks the coordinator to write the first scopes and tasks as tree nodes with
  `touches` and `local_success`. Extend `TreeNode` with `owner`, `leaseUntil`, and `evidence`
  rather than inventing a second task type.
- Add `claim_task` and `complete_task` verbs to the tool. Claims are atomic in the hub (one
  writer per store) and carry a lease.
- Workers are detached chats the app starts from `HiveConfig.workers`, each with worker guidance
  that says: read the snapshot, claim one ready task, work, record evidence, release or complete.
- The canvas shows nodes changing because a chat wrote them. The journal is the event log the
  blueprint describes; the file view stays a projection.

Verification: one coordinator and one worker on a scratch project; the worker claims a task the
coordinator wrote, finishes it, and the pane shows it without any renderer-side timer.

### Slice D: catch-up and closure from real data

Goal: the report, acknowledgement, proposal, and acceptance path runs on store data.

- `buildCatchUp`, `closureProgress`, and `canPropose` already take nodes and a record. Feed them the
  snapshot. Move `reports`, `proposal`, and `acceptedAt` into the store so acknowledgement survives
  a restart.
- The completion proposal comes from the coordinator through the tool, not a 900 ms timer.

## Working rules for parallel panes

- **One pane per slice.** Before starting, read this file and `git log --since=1.day -- src/renderer/agent-workspace src/main/project-store src/shared/project`.
  If another pane touched those paths in the last hour, coordinate through the user first.
- **Ownership by path.** Slice A: `src/main/project-store/`, `src/main/project-ipc.ts`, preload
  `project.*`, `src/renderer/agent-workspace/`. Slice B: `src/main/tools/project/`,
  `src/main/chat-context/agent-workspace-instructions.ts`. Slice C touches all of them, so it waits
  for A and B to land.
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

## Decisions that belong to the owner

1. **Store format.** Keep the JSON store as the source and generate Markdown views later if humans
   need them, or move to the blueprint's Markdown-and-Git layout now. Recommendation: keep JSON.
   The shape exists, is normalized, and is already ignored by git. Markdown is a projection.
2. **Workers in slice C.** App-spawned detached chats from `HiveConfig`, or existing user-opened
   panes that opt in. Recommendation: app-spawned, because leases and recovery need the app to
   know who is alive. Existing panes can join later through the same tool.
3. **Coordinator scope now.** Keep the coordinator prompt to intake plus record-writing (slice B),
   or extend it to planning in the same slice. Recommendation: intake plus record-writing first;
   planning arrives with slice C where it has real workers to plan for.

## Out of scope for this phase

Background execution while the app is closed, worktree or container isolation, merge queues,
quality observers, multiple coordinators, and the aggregated command surface. Each is a later
blueprint stage and depends on stage 1 working on a real project first.
