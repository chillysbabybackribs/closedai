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
| Hydration from disk when the file already holds work | Live, read-only | `hydrate-project-snapshot.ts`, `use-project-workspace-effects.ts` |
| Restart control, `closedai_ui.capture` `agent_workspace` | Live | `layout.agent-restart`, `src/main/tools/capture/agent-workspace.ts` |
| Direction record filled from the transcript | Prototype | `syncDiscoveryWithItems` maps user message N to pillar N and invents unknowns and evidence |
| Canvas after "Start building" | Prototype | `buildDispatchPlan` fires a fixed 18-event script on timers; nothing runs |
| Journal, catch-up, closure gates, completion proposal | Prototype | Computed from the simulated tree in local React state |
| Any write from renderer to store | Missing | No `project:*` mutation channel exists |
| Any model tool that reads or writes project state | Missing | `src/main/tools/browser/project.ts` is JSON projection, unrelated |
| Worker chats, claims, leases | Missing | `HiveConfig` is defined but nothing consumes it |

The consequence: everything the user sees after intake is theatre, and the intake record itself is a
guess. The store is the only durable thing, and nothing writes to it except the default file on first
open.

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

### Slice A: write path

Goal: what the user does in the pane survives a restart, and no state lives only in React.

- Add `project:*` mutation invokes through `ProjectHub`: patch direction and `discoveryAsking`,
  set phase and timestamps, apply a tree event (add or update node), append a journal line, set the
  coordinator binding. Keep them as a small verb set on the hub, not one per field.
- The renderer calls these instead of `setTree`, `setJournal`, `setPhase`, and `setDiscovery`, and
  renders from the `project:event` snapshot. `hydrateFromSnapshot` becomes the only way state
  enters the component.
- Move `buildDispatchPlan` and the timers behind the canvas fixture so the live path never runs
  them. Keep the fixture for tests and screenshots.
- Bump the store version only if the file shape changes; `normalize.ts` must read version 1 files.

Verification: answer intake in the running app, quit, relaunch, reopen the pane: same record and
phase. Test in `project-store.test.ts` and a renderer test that the workspace issues mutations,
not local state changes.

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
- **Do not raise caps or add exceptions** to work around a large file. `project-workspace.tsx` is
  at 442 of 450 lines; slice A should shrink it by moving state out, not split it mechanically.

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
