# Live app evaluation (human-in-the-loop)

Design tasks here, then run them in a **fresh chat pane** inside ClosedAI while you watch tool
calls, latency, and UX. This is separate from `harness/tasks/` replay and headless Codex runs
(stub fixtures, automated oracles).

## Start: mission loop pilot (no UI changes)

1. In your **home** chat (director), read or attach `harness/live-eval/director-charter.md`.
2. Print the pilot task:

   ```sh
   npm run harness:live -- --task=mission_loop_pilot_01
   ```

3. Send the **User message** block from that output as your next message (or tell the model to
   run that task after reading the charter).
4. Watch the browser if a task uses it; score against the **Observe** list. The transcript is the
   log; `harness/out/current-mission.md` is continuity only.
5. Optional notes: `harness/out/live-eval-notes.md` (gitignored).

## Task file

- `tasks.json` — natural-language `user` prompts, optional `setup.browserUrl`, and an `observe`
  checklist for the human reviewer.
- `schema.json` — optional validation shape.

List or inspect tasks:

```sh
npm run harness:live -- --list
npm run harness:live -- --task=browser_ambient_github
```

## Monitor workflow

1. Pick a task (`npm run harness:live -- --task=<id>`).
2. **New chat** in the app (File → New chat or `closedai_app.command` `new_chat`).
3. **Select model** on that pane (`select_model` with the task's `modelId` when set).
4. **Setup** — if `setup.browserUrl` is set, navigate the embedded browser there (human or
   `browser_tab` / `embedded_browser.page` from an orchestrator pane).
5. Paste or **send** the task `user` text as the first message in the eval pane.
6. Watch the turn: tool choice, errors, self-pause, browser pane behavior. Score against `observe`.
7. Record notes in `harness/out/live-eval-notes.md` (informal) or your own spreadsheet.

An orchestrator chat (not the eval pane) can launch steps 2–5 via `closedai_app.command` with
`send_message` and `await_turn: false` so you can watch the eval pane work in real time.

## Relation to automated harness

| Path | What runs | Who scores |
|------|-----------|------------|
| `npm run harness:replay` | Deterministic tool replay + oracle | CI |
| `npm run harness:codex` | Live Codex turn in temp cwd + fixtures | Oracle |
| Live eval (this folder) | Real Electron app, real browser session | Human + `observe` list |

Promote a mature live task into `harness/tasks/*.json` when you have a stable oracle and fixture.
