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
| Direction record filled from the transcript | Prototype | `syncDiscoveryWithItems` maps user message N to pillar N and invents unknowns and evidence; now persisted through `direction` mutations so Start is reachable in the live pane |
| Canvas after "Start building" | Empty | Only the root node; nothing dispatches work until slice C. `buildDispatchPlan` is fixture-only |
| Acknowledged reports, open completion proposal | Prototype | Local React state and a 900 ms proposal timer; slice D |
| Any model tool that reads or writes project state | Missing | `src/main/tools/browser/project.ts` is JSON projection, unrelated |
| Worker chats, claims, leases | Missing | `HiveConfig` is defined but nothing consumes it |

The consequence: the store is now the source of truth for everything the pane shows, but the record
in it is still a positional guess and nothing fills the tree. That is what slices B and C are for.

## Target for this phase

Blueprint stage 1, "durable peer coordination", scoped to what the pane already shows:

- The store is the shared state. The pane is a view of it, never a second source of truth.
- The coordinator model, not a regex over the transcript, fills the direction record.
- "Start building" produces real tree tasks written by the coordinator. Worker chats claim them,
  work, and record results through the same store.
- Everything on the canvas is a projection of store events. Timers and fixture data exist only in
  tests.

Stages 2 to 6 (background execution, adaptive coordinators, branches, observers, command surface)
are out of scope until stage 1 runs end to end on a real project.

## Slices, in order

Each slice is shippable alone, verified in the Electron app, and owned by one pane at a time.

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
`src/renderer/agent-workspace`, hygiene, and a production build. Owner check still to do: answer
intake in the running app, press Start, quit, relaunch, reopen the pane, and see the same record,
root node, and journal.

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
