# Agent builder progress

## Location and scope
- Cycle 1, 2026-10-02. User corrected the working folder to `/home/dp/Documents/closedai` (HEAD `9a722625`). Use this folder for every later cycle. The original `/home/dp/Desktop/close/closedai` checkout has no builder source; nothing was edited there.
- Minimal scope, from `docs/application.md` agent-builder/run sections: preserve editable instructions and saved settings; safely optimize drafts; start the existing bounded/supervised cycle loop; retain progress across thread changes; recover by pausing on relaunch/failure; finish without another cycle. Keep builder instructions out of ordinary chat/provider defaults. No new access model, scheduler, or unattended reliability guarantee.

## Completion checklist
- [ ] Optimizer cancellation/failure preserves drafts; proposals respect manual edits; save/start use validated settings. Inspect and run existing targeted tests next.
- [x] Existing loop tests pass: repeated cycles, thread reseeding, empty-turn retry/backoff, watchdog, first-send failure, pause/resume/stop, user-turn interleaving, cycle/time limits, supervision, relaunch and archive handling.
- [x] Existing app-tool tests pass: finish targets caller only; other lifecycle actions refuse caller; ordinary state, commands, send-message and UI routing still pass.
- [ ] Verify completion through the service (tool test currently uses a host stub), persisted recovery and ordinary chats receiving no builder cycle/instructions. Existing coverage needs inspection before adding tests.
- [ ] Resolve any reproduced gaps without overlapping pre-existing work; relevant checks and map current. Not complete.

## Workspace ownership
- Initial Documents checkout was already heavily dirty. All existing source changes belong to prior work. Do not overwrite or edit overlapping files under this task's boundary.
- Pre-existing modified areas: main agent-library store/IPC and tests; agent-run service/tests; app commands/tools/host/index/tests; main startup/IPC; title provider/tests (title-process deleted); preload; renderer agent library/runs and tests; App/menu/shortcuts/composer; chat layout/floating and styles (several floating modules deleted); shared agent/library/API/IPC/UI-control contracts/tests; application/tools guides; both `scripts/generated/workspace-*.ts` maps.
- Pre-existing untracked work: optimizer-instructions and prompt-optimizer implementations/tests, `src/main/ephemeral-model/`, builder draft/suggestions helpers/tests, optimizer hook, builder sections/settings/suggestion cards/style, shared agent-optimizer contract, and `docs/agent-run-access-investigation-2026-10-02.md`.
- This cycle creates only this record. No product implementation or existing test was edited. Core loop and optimizer fixes currently overlap prior work; select independent verification first and record any concrete conflict before editing.

## Locations and boundaries
- `src/main/agent-runs/agent-run-service.ts`: per-chat loop, timers/retries, pause/resume, rotation, persistence on `ChatRecord.agentRun`; `ipc.ts` is the renderer adapter.
- `src/shared/agent-runs.ts`: cycle messages, settings, normalization and timing helpers. Run-only prompt assembly must stay here/in run service, not shared chat instructions.
- `src/main/tools/app/agent.ts`: finish calls host on caller; other verbs require another explicit pane. `src/main/app-commands.ts` connects tool to service.
- `src/main/agent-library/`: saved entries and optimizer; `src/renderer/agent-library/`: builder/draft state. Optimizer uses shared `src/main/ephemeral-model/` also used by chat titles; changes there could affect ordinary chat.
- Read relevant `docs/application.md`, `docs/model-context.md`, `docs/tools.md`, and local AGENTS.md. Current docs describe app-level enforcement of limits/supervision, no enforceable per-run access setting, optimizer without tools or persisted session, and relaunch-paused recovery.

## Verification and next work
- PASS: `CLOSEDAI_WORKSPACE_CWD=/home/dp/Documents/closedai npm run test:one -- src/main/agent-runs/agent-run-service.test.ts src/main/tools/app/app.test.ts` — 39/39.
- Tooling discovery: npm is `scripts/closedai-bin/npm`; its shim uses `CLOSEDAI_WORKSPACE_CWD` rather than shell cwd. Set that variable for npm commands in this session. Initial unqualified test command ran against the old folder and failed with missing script; it tested nothing. Shim handles heavy-command locking; do not double wrap.
- Pre-existing FAIL: `npm run map:check` (with corrected cwd) reports stale index before this record existed. Generated maps already contain someone else's changes. Defer regeneration to avoid overlapping those edits; this new record also needs indexing once that conflict is resolved.
- No typecheck/build/live run performed: record-only cycle. No other chat, tab, or agent was controlled. Live app state confirmed this run at cycle 1 and saved agents, but does not prove it loaded this checkout's current source.
- Next smallest task: inspect existing optimizer and draft tests, run the targeted checks, and identify a concrete gap or missing isolation/completion regression. Do not expand the roadmap. A needed fix in dirty files requires resolution of ownership conflict.
- Evidence limits: mocked loop/provider tests do not prove disk recovery, provider integration, UI correctness, model adherence to a progress file, or indefinite unattended reliability.
