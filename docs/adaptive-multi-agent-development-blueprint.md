# Adaptive multi-agent development blueprint

Status: product and architecture proposal, not implemented behavior  
Date: 2026-09-21

## Purpose

This blueprint describes a development environment in which a user guides a persistent group of
model agents while they continuously build and improve a complex application.

The user supplies the original idea and remains the ultimate overseeing eye. They can observe,
question, redirect, or add ideas whenever useful. They do not need to dispatch every task or pause
the workforce while changing direction. The root coordinator absorbs new direction, updates the
shared understanding, and changes upcoming work while unaffected workers continue.

The system is deliberately adaptive:

- The overall goal provides continuity without becoming a frozen specification.
- Architecture, product scope, quality targets, non-goals, and deployment choices may evolve.
- Plans cover the useful near horizon rather than pretending to predict the full build.
- Building, testing, research, and user feedback continuously alter what the system understands.
- Agents coordinate through durable shared state; no conversation is the sole source of truth.
- Roles are capabilities that agents can assume and release, not permanent identities.

The target is not a one-prompt, unattended application generator. It is a user-guided,
continuously operating development organization.

## Foundational interaction

The smallest useful form has two peer chats and a shared work document:

1. The user gives one chat a goal or direction.
2. That model writes instructions and candidate tasks into shared state.
3. Either model can claim a ready task.
4. The claimant records that work has started.
5. It implements, tests, and records the result, discoveries, and follow-up work.
6. The other model reads the updated state and continues from the new reality.
7. Whichever model is free may coordinate, implement, test, research, or maintain the project.

The larger system should preserve these properties:

- Work does not depend on one permanent delegator.
- Agents can create useful work discovered during execution.
- Handoffs are durable and inspectable.
- Coordination can continue after a model context ends or an agent is replaced.
- The repository and verified artifacts outrank an agent's narrative claim.

## Core principles

### The user is the root authority

The root coordinator is the user's main relationship with the system, but it is not an authority
above the user. New user direction immediately becomes the highest-priority project signal.

The coordinator should explain its current understanding and likely consequences. It should not
force the user to approve a complete plan before useful work begins.

### Direction changes are normal

A direction change creates a new revision of shared project understanding. It does not
automatically stop the workforce.

Active work is classified as:

- **Unaffected:** continue normally.
- **Still useful:** finish, but interpret the output under the new direction.
- **Adapt next:** finish the safe current unit, then change course.
- **Invalidated:** stop at the next safe boundary and preserve recoverable work.
- **Conflicting:** ask the responsible coordinator to reconcile the conflict.

The default is continuity, not global cancellation.

### Planning is rolling and evidence-driven

The project maintains:

- A broad direction.
- A more concrete current understanding.
- A small set of near-term outcomes.
- Ready tasks derived from the current repository and observations.

Long-range plans are hypotheses. Coordinators revise them when implementation, tests, research,
tool failures, or user feedback reveal better information.

### Shared state is the coordination surface

Chats and model contexts are transient. Tasks, events, decisions, branches, test evidence, and
artifacts are durable.

An agent beginning work should be able to orient itself from current shared state without needing
another agent to restate the project.

### Local ownership, global visibility

At any moment, one agent owns a particular mutation, task, or decision scope. Every coordinator
can observe the broader state and create proposals, discoveries, or dependencies.

This prevents simultaneous conflicting writes without making knowledge or initiative exclusive.

### Quality is an active participant

Quality is not a final stage. Test, hygiene, security, documentation, performance, duplication,
tool-health, and visual-review agents continuously observe the project and introduce or perform
work as the application evolves.

### Useful work must remain inspectable

Every completed task should leave evidence appropriate to its effect:

- A commit or diff.
- Tests or checks that ran.
- Screenshots or interaction evidence for visual behavior.
- Sources for current external claims.
- Logs, traces, or measurements for runtime claims.
- Notes about limitations, uncertainty, and newly discovered work.

## Conceptual organization

```text
User
  │
  ▼
Root coordinator
  │
  ├── coordinator for a current product area
  │     ├── implementation workers
  │     ├── research workers
  │     └── local reviewers
  │
  ├── coordinator for another product area
  │     └── workers and reviewers
  │
  ├── integration coordination
  └── continuous observers
        ├── tests and regressions
        ├── architecture and duplication
        ├── hygiene and repository rules
        ├── security and permissions
        ├── tool failures and reliability
        ├── documentation freshness
        └── UI behavior and visual quality
```

This is a changing topology, not an organization chart.

- A coordinator can implement when that is the best next action.
- A worker can discover and propose a new body of work.
- A worker can become a coordinator after completing its task.
- Coordinators can split a growing scope or merge scopes that no longer need separation.
- Reviewers can become implementers for repairs they clearly understand.
- Agents can disappear after contributing their durable result.

## Root coordinator

The root coordinator maintains the relationship between user direction and project activity.
Its responsibilities are:

- Keep the current goal legible without turning it into a frozen contract.
- Translate new user direction into shared project updates.
- Summarize material consequences, alternatives, and emerging risks.
- Maintain a rolling view of important outcomes and cross-area dependencies.
- Create, divide, combine, or retire coordinator scopes.
- Resolve ownership conflicts or assign a temporary arbiter.
- Keep the user informed without requiring routine approvals.
- Surface decisions where human taste, product judgment, or risk makes input especially valuable.

The root coordinator should stay responsive. It may do implementation or research, but it should
not become unavailable for long periods while other coordinators need direction.

It should not micromanage every worker. Coordinators and workers consume the shared direction and
adapt their own next work.

## Coordinators

Coordinators own temporary scopes such as:

- A feature or user journey.
- Frontend, backend, data, or infrastructure work that is currently substantial.
- A migration or architectural experiment.
- Integration across several branches.
- A quality problem spanning multiple tasks.
- Research needed to choose among approaches.

A coordinator:

1. Reads current direction and repository state.
2. Maintains a rolling local view of its scope.
3. Creates small enough tasks for independent progress.
4. Assigns or exposes ready work.
5. Watches results, dependencies, and invalidations.
6. Integrates useful outcomes.
7. Reports discoveries upward and sideways.
8. Revises its scope when project direction changes.

Several coordinators may run concurrently, but overlapping mutation authority must be resolved
explicitly. Consensus between models is not required. A single temporary owner makes each
decision, while dissent and alternatives remain recorded.

## Workers and observers

Workers perform bounded units of implementation, investigation, verification, or repair.

Potential specialties include:

- Feature implementation.
- UI and interaction development.
- Visual testing and accessibility review.
- Backend, data, and infrastructure work.
- Official-documentation and best-practice research.
- Dependency and API-version review.
- Test creation and regression investigation.
- Tool-error diagnosis.
- Duplicate-code and inconsistent-pattern detection.
- Hygiene-cap and architecture-boundary monitoring.
- Security and trust-boundary review.
- Performance and observability analysis.
- Documentation gardening.
- Merge-conflict resolution.

Specialization should not prevent initiative. A worker that finds a separate problem records it
as an observation or candidate task rather than silently expanding its active task.

## Shared project state

An initial implementation may use Markdown and Git. Scale may justify a transactional store and
event stream, while retaining generated Markdown views for humans and models.

A possible repository layout:

```text
.coordination/
├── GOAL.md
├── CURRENT_STATE.md
├── NEXT.md
├── USER_DIRECTION.md
├── tasks/
├── observations/
├── decisions/
├── explorations/
├── branches/
├── quality/
├── tool-health/
└── events.jsonl
```

### `GOAL.md`

A concise, editable description of what the user is trying to create and why. It should remain
broad enough to survive natural product evolution.

### `CURRENT_STATE.md`

A generated or carefully maintained account of what exists now:

- Working capabilities.
- Current architecture.
- Known weaknesses.
- Active product direction.
- Important technical assumptions.
- Current deployment reality.

It describes the present rather than promising the future.

### `NEXT.md`

The rolling horizon:

- Important near-term outcomes.
- Current priorities.
- Major dependencies.
- Active questions.
- Work likely to become ready soon.

It is expected to change frequently.

### `USER_DIRECTION.md`

An append-oriented record of user steering, with revisions and the root coordinator's interpretation.
Later direction may supersede earlier direction without erasing why earlier work occurred.

### Tasks

Each task has a stable identity and enough structure for safe claiming:

```yaml
id: ui-navigation-014
title: Explore persistent project navigation
state: claimed
owner: chat-27
coordinator: experience-navigation
direction_revision: 18
branch: explore/persistent-project-navigation
claimed_at: 2026-09-21T22:00:00-04:00
lease_until: 2026-09-22T00:00:00-04:00
depends_on: []
touches:
  - src/renderer/navigation/
local_success:
  - application remains runnable
  - exploration includes visual evidence
```

The task may also contain narrative notes, discoveries, verification evidence, and follow-up
proposals. Local success criteria guide the current unit; they are not an immutable global contract.

### Observations

Observations capture facts or hypotheses that do not yet deserve tasks:

- A recurring tool error.
- Duplicate patterns.
- A product opportunity.
- An outdated dependency.
- An architectural pressure.
- A user-experience inconsistency.

Coordinators periodically promote, combine, defer, or dismiss observations.

### Decisions

Decisions are versioned and explicitly revisitable:

```yaml
decision: Keep browser state app-wide
status: provisional
confidence: medium
reason: Current workflows benefit from one signed-in session
reconsider_when:
  - project isolation becomes a user requirement
  - cross-project actions produce unsafe interference
```

Changing a decision emits an invalidation event for tasks and assumptions that depended on it.

### Events

The event stream records coordination transitions without forcing every agent to reread every
task document:

- Direction added or revised.
- Task proposed, claimed, released, blocked, completed, or invalidated.
- Branch created, updated, merged, or abandoned.
- Decision proposed, adopted, challenged, or superseded.
- Tool incident opened or resolved.
- Test or quality regression detected.
- Artifact produced.

Current Markdown files can be projections of these events rather than competing logs.

## Coordination channels

Agent communication should use typed intents even when the underlying transport is a file or
mailbox:

| Channel | Purpose |
|---|---|
| Direction | User steering and coordinator interpretation |
| Work | Task creation, claim, progress, release, completion |
| Dependency | Blocking relationships and interface readiness |
| Discovery | New knowledge, opportunities, and concerns |
| Decision | Proposals, alternatives, decisions, and invalidations |
| Review | Critique, evidence requests, and requested repairs |
| Integration | Branch readiness, conflicts, and merge outcomes |
| Incident | Tool, environment, agent, or systemic failures |
| Presence | Lease, heartbeat, availability, and current scope |

Messages should link to tasks, branches, commits, decisions, or artifacts. Free-form discussion
remains useful, but it should produce durable state when it affects later work.

## Direction propagation without interruption

When the user gives the root coordinator new direction:

1. Record the user's words as a new direction revision.
2. Interpret the likely project impact.
3. Update `GOAL.md`, `CURRENT_STATE.md`, or `NEXT.md` only where appropriate.
4. Notify affected coordinators through a direction event.
5. Re-rank or revise unclaimed work.
6. Let unaffected active workers continue.
7. Ask affected workers to adapt at a safe boundary.
8. Invalidate active work only when continuing would be wasteful, unsafe, or destructive.
9. Preserve stopped work and its evidence for possible reuse.
10. Summarize material consequences to the user.

Workers do not all need the entire user conversation. They need the current direction revision,
the relevant change, and its relationship to their task.

## Task lifecycle

A useful initial lifecycle:

```text
proposed
  → ready
  → claimed
  → working
  → verifying
  → completed

claimed/working/verifying
  → blocked
  → released
  → invalidated
  → failed
```

Important rules:

- Claims are atomic.
- Claims have leases so dead agents do not own work forever.
- A stale owner cannot publish completion after reassignment without reconciliation.
- Dependencies determine readiness, but agents may challenge stale dependencies.
- Completion includes evidence, not just a status change.
- A task can create tasks, observations, decisions, or explorations.
- Blocked agents may take other ready work.
- Background maintenance must avoid files owned by active tasks unless coordinated.

## Productive waiting

When blocked, agents may perform bounded work that improves project understanding without
interfering with active mutations:

- Run relevant tests.
- Investigate a known failure.
- Read current official documentation.
- Review completed changes.
- Improve evidence or reproduce a bug.
- Inspect hygiene, duplication, or stale documentation.
- Prepare a proposal or exploration branch.

Agents should not perform arbitrary cleanup merely to stay busy. Cleanup becomes explicit work
with ownership, scope, and evidence.

## Branches and workspaces

Branches support both isolation and exploration.

### Task isolation

Each mutating worker receives a worktree or equivalent isolated workspace. Short-lived task
branches reduce accidental interference and make incomplete work recoverable.

### Exploratory branches

Competing product or architectural directions can coexist:

```text
main
├── explore/navigation-sidebar
├── explore/navigation-command-surface
└── explore/navigation-spatial-canvas
```

Exploration agents produce working artifacts, evidence, and trade-offs. The user or responsible
coordinator may combine, continue, or abandon them.

### Coordinator integration branches

When a body of work needs several workers:

```text
main
└── integration/browser-workspaces
    ├── task/persistence
    ├── task/tab-model
    └── task/layout-ui
```

Integration branches should remain bounded and regularly reconcile with their parent. Deep,
long-lived branch trees create drift and should be treated as a visible project risk.

### Merge behavior

- Leaf workers publish verified commits.
- Coordinators integrate within their scope.
- Integration work runs relevant cross-area checks.
- Conflict resolution considers both code and current direction.
- A merge can invalidate downstream assumptions and must emit that fact.
- Main should remain the most coherent runnable version, not necessarily the only active idea.

## Continuous quality and maintenance

Quality observers run independently of implementation scheduling.

### Tool health

Monitor:

- Repeated invalid tool calls.
- Timeouts and flaky operations.
- Permission or environment failures.
- Output truncation that prevents decisions.
- Agent loops that repeat the same failed operation.

Incidents should be clustered so one systemic defect does not become hundreds of duplicate tasks.
A tool-health coordinator may repair the tool, improve its instructions, add a fallback, or mark a
capability temporarily unavailable.

### Code and architecture

Monitor:

- Duplicate or diverging implementations.
- Boundary violations.
- File and complexity caps.
- Unused or obsolete code.
- Inconsistent conventions.
- Dependency drift.
- Stale assumptions after architectural changes.

Deterministic checks should replace repeated model judgment whenever a useful rule becomes stable.
The rule itself remains revisitable as the project evolves.

### Tests and behavior

Maintain:

- Fast local checks for worker feedback.
- Broader integration checks.
- Regression tests derived from failures.
- End-to-end checks for important user journeys.
- Visual and accessibility evidence for UI changes.
- Runtime logs, metrics, and traces where relevant.

Tests are evidence and feedback, not the complete definition of product correctness.

### Current information

Research workers should:

- Prefer current official documentation.
- Record source URLs and retrieval dates.
- Identify version-sensitive advice.
- Distinguish documented behavior from inference.
- Emit invalidations when external APIs or best practices change.

## Failure and recovery

The control system should assume that models, tools, processes, and branches will fail.

- Leases recover abandoned work.
- Heartbeats reveal stalled agents.
- Checkpoints preserve partial progress.
- Retries are bounded and reason-aware.
- Repeated equivalent failures become one incident.
- A replacement agent reads durable state and resumes.
- Coordinators may split a stuck task, try a competing approach, or defer it.
- Uncertain mutations are reconciled before retry.
- User direction remains available even if the root coordinator is replaced.

No agent's disappearance should erase the reason work exists or the evidence already produced.

## Preventing coordination collapse

As the agent count grows:

- Limit each coordinator's active workers.
- Add workers only when ready work and integration capacity exist.
- Apply backpressure when review, testing, or merging falls behind.
- Fingerprint tasks and observations to detect duplicates.
- Partition task and event reads by relevant scope.
- Periodically replace long-lived model contexts while preserving durable state.
- Aggregate routine progress rather than broadcasting it to every agent.
- Give one temporary owner to each contested decision or mutation.
- Retire coordinators whose scopes have completed or merged.

The system should scale useful throughput, not agent count.

## User experience

The default UI presents the evolving project, not a wall of model transcripts.

### Root view

Show:

- Current goal and recent user direction.
- Root coordinator summary.
- What changed recently.
- What is being built now.
- Active coordinator scopes.
- Important branches and explorations.
- Emerging decisions and alternatives.
- Quality, integration, and tool-health signals.
- Work that may benefit from user judgment.

### Direction

The user talks to the root coordinator naturally. The UI shows how that direction changes the
rolling project state without implying that every worker stopped and restarted.

The root coordinator should distinguish:

- Direction already absorbed.
- Work that will adapt next.
- Active work still finishing.
- Work intentionally invalidated.
- Questions where user input would add significant value.

### Drill-down

The user can move through:

```text
Project
  → coordinator scope
  → outcome or exploration
  → task
  → attempt
  → transcript, tools, diff, tests, and artifacts
```

Transcripts remain available for understanding behavior, but task and project state are the
primary navigation.

### Human attention

The system may surface:

- Meaningfully different product directions.
- High-impact architectural changes.
- Risky or irreversible actions.
- Persistent failures.
- Large cost or time changes.
- Results where human taste is especially valuable.

These are opportunities for contribution, not routine gates that freeze unrelated work.

## Example evolution

1. The user asks for a collaborative visual research application.
2. The root coordinator records the broad goal and creates a small initial foundation.
3. Workers establish a runnable shell, data model experiments, and several interface sketches.
4. A UI observer finds that the initial navigation does not support the emerging workflow.
5. Two exploration branches test different navigation models.
6. The user sees one branch and asks to emphasize spatial organization instead.
7. The root coordinator records the new direction and changes upcoming UI work.
8. Backend, research, and test workers continue because their current work remains useful.
9. The original navigation worker finishes its bounded prototype and records reusable findings.
10. The spatial branch becomes the integration direction.
11. Quality observers identify performance and accessibility work as the application grows.
12. Coordinators continuously reshape the next horizon around the working product and user input.

At no point was the final application hardcoded from the first request, and no global pause was
required for the user to redirect it.

## Incremental implementation path

The Project shell is the entry point rather than the last stage: the discovery conversation and
its direction record are where the shared-state model gets defined, so the UI prototype under
`src/renderer/preview/project-*.tsx` is being built first to discover that model. The stages
below describe the runtime that grows behind it.

### Stage 1: durable peer coordination

- Shared goal, current-state, and task documents.
- Atomic claims and completion evidence.
- Two or more chats that can read and update the same project state.
- User manually chooses which chat to run.

### Stage 2: continuous peers

- Background execution.
- Leases, presence, and recovery.
- Typed direction, work, discovery, and incident events.
- Automatic selection of ready work.

### Stage 3: adaptive coordinators

- Root coordinator as the user's primary interface.
- Temporary coordinator scopes.
- Rolling planning and direction propagation.
- Worker-to-coordinator promotion and coordinator retirement.

### Stage 4: isolated branches and integration

- Worktree or container isolation.
- Exploratory and integration branches.
- Merge queues, invalidation events, and integration checks.

### Stage 5: continuous observers

- Tool-health, testing, architecture, hygiene, research, security, and visual-quality agents.
- Deduplicated observations and incidents.
- Stable findings promoted into deterministic checks.

### Stage 6: project command surface

- Aggregated project view.
- Direction-impact visualization.
- Coordinator, branch, quality, and incident views.
- Task and agent drill-down.
- User steering through the root coordinator.

Each stage should be useful on its own. Later stages extend the original peer foundation rather
than replacing it with a rigid workflow engine.

## Evaluation questions

The project should be judged by outcomes such as:

- Can a new agent orient itself from shared state?
- Does work continue safely after user redirection?
- Do workers avoid duplicate and conflicting work?
- Can the user understand what changed and why?
- Are discoveries reflected in future work?
- Can failed agents be replaced without losing project continuity?
- Does adding workers improve verified throughput?
- Do quality observers find problems before they spread?
- Can the system preserve multiple promising directions without destabilizing main?
- Does the root coordinator remain responsive while the workforce operates?
- Can the user intervene at any depth without becoming the scheduler?

Raw agent count, token consumption, code volume, and task completion count are not success
measures by themselves.

## Open design questions

- Which shared-state primitives belong in Git, and which require a transactional store?
- How should task claims remain atomic across local and cloud workers?
- How much context should direction events carry to affected workers?
- When should active work adapt immediately versus finish its current unit?
- How should coordinator scopes be created, split, merged, and retired?
- How should exploratory branches be compared without reducing product judgment to one score?
- Which observations may automatically become tasks?
- How should user attention be ranked without hiding important uncertainty?
- How should the system measure useful integration throughput and coordination overhead?
- What is the smallest UI that makes the adaptive process understandable?

These questions should be answered through progressively larger working experiments, beginning
with the shared-state peer model.

## Research basis

This proposal is informed by public examples while intentionally preserving a different,
user-guided adaptive model:

- [Cursor: Scaling long-running autonomous coding](https://cursor.com/blog/scaling-agents)
- [Cursor: Introducing Projects](https://cursor.com/blog/projects)
- [Anthropic: Building a C compiler with a team of parallel Claudes](https://www.anthropic.com/engineering/building-c-compiler)
- [Anthropic: How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Anthropic: Claude Code agent teams](https://code.claude.com/docs/en/agent-teams)
- [OpenAI: Harness engineering](https://openai.com/index/harness-engineering/)
- [OpenAI: Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness/)

These systems provide evidence about delegation, isolation, task coordination, observability, and
scale. They do not establish that a fixed plan or unattended start-to-finish build is the correct
product model for ClosedAI.
