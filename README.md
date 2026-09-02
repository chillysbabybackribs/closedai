# closedai

An Electron 44 workspace with two first-class panes: one embedded Chromium browser and one
Prompt Kit-powered chat that runs on Codex (app-server) or Claude Code (Claude Agent SDK). The browser is the appv1 embedded browser lineage
(same tab strip, omnibox, downloads shelf, dark chrome, session partition, cookie import, and
popup-to-tab routing). The chat is a local Codex app-server client with thread history, model
selection, approval handling, attachments, and ClosedAI-owned browser/capture/CDP tools.

One long-lived local app-server process serves each live chat pane. On launch, only the selected
pane is warmed; persisted background panes stay dormant until used. The renderer only talks to
the main process through the typed `window.closedai` preload bridge.

## Run

```sh
npm install --include=dev   # devDependencies hold electron/vite; NODE_ENV=production skips them
npm run dev                 # electron-vite dev with hot reload
npm run build && npm run preview
npm run check               # map, hygiene, types, tests, production build, and import closure
```

ClosedAI resolves `codex` from `PATH`. Set `CLOSEDAI_CODEX_PATH` to use a specific CLI
binary and `CLOSEDAI_WORKSPACE` to override the app-server working directory. Claude Code needs no
binary on `PATH`: the pinned `@anthropic-ai/claude-agent-sdk` ships its own CLI, and it uses the
sign-in the `claude` CLI keeps (`docs/claude-code.md`).

`scripts/launch-electron-vite.mjs` scrubs GPU-offload variables (hybrid-GPU Linux) and any
`ELECTRON_EXEC_PATH` / `ELECTRON_*` identity a parent Electron app exported, so the app always
runs on the Electron installed here.

## Layout

- `src/main` - bootstrap (`index.ts`), `ChatHub` over `ChatService` (Codex) and
  `src/main/claude/` (Claude Code), `BrowserService` / `BrowserTab`
  (WebContentsView per tab), browser session identity + cookie persistence + first-launch
  cookie import, downloads, tab-session/history/settings JSON stores, permission policy
  (allow-all, see `docs/electron-browser-platform-review.md` section 0), popup bridge,
  context menus, and the model tool registry.
- `src/main/tools` - provider-agnostic tools. Current namespaces are `embedded_browser`
  (page navigation and reading), `closedai_ui` (app/page screenshots and crops), `browser_cdp`
  (semantic page interaction plus raw Chrome DevTools Protocol access), `search` (routed public-web
  search), `tool_batch` (bounded sequential or parallel tool calls), and, when the app-server
  workspace is this checkout, `closedai_workspace` (deferred repository navigation).
- `src/preload` - the `window.closedai` bridge (`src/shared/api.ts` is its type).
- `src/shared` - dependency-free IPC contracts for browser, chat, tools, and shared types.
- `src/renderer` - `App.tsx`, the split workspace, browser pane, chat pane, history drawer,
  composer, attachment handling, screenshots, and the Tools modal.
- `docs/tools.md` - the model tool architecture, current namespaces, telemetry, and modal.
- `docs/claude-code.md` - the Claude Code provider: session shape, lifecycle, history, transcript
  mapping, and every SDK contract it relies on.
- `docs/cdp-tool-foundation.md` - lifecycle and usage notes for the raw CDP tool.
- `docs/electron-browser-platform-review.md` — the dated Electron/Chromium design review,
  owner decisions, and implementation-status matrix.
- `docs/autogit.md` — optional automatic working-tree snapshots through a systemd user service.
- `THIRD_PARTY_NOTICES.md` — attribution for the Prompt Kit-derived chat components.

## State

Electron's `app.getPath('userData')` directory (`~/.config/closedai/` on Linux):
`browser-tabs.json` (restored on launch), `browser-history.json`
(omnibox suggestions), `app-settings.json` (cookie-import latch, current Codex thread, current Claude session
(`chatClaudeSessionId`), selected model (a `claude:` prefix selects Claude Code), `chatReasoningEffort`
(null follows the model default), disabled tool or action ids, `chatCompactAtPercent`, the context-usage percentage after which the
app compacts between turns; default 80, 0 disables, and `chatMidTurnCompactTokens`, an opt-in
context size in tokens past which Codex compacts mid-turn; default 0 keeps Codex's own limit, and
`toolBatchMaxCalls`, the startup batch limit; default 16 and clamped to 1–64),
`tool-telemetry.json` (aggregate tool run/error counts only), `code-cache/`, and
Chromium's `Partitions/browser` profile.

## Chat and tools

The model picker lists both providers. A thread belongs to the provider that started it: picking a
model from the other provider shows that provider's current thread (the old one stays in history), and
opening a thread from history switches providers. Claude Code threads live in the Agent SDK's own
session store and use the same ClosedAI tools through in-process MCP servers (`docs/claude-code.md`).

`ChatService` starts `codex` from `PATH` (or `CLOSEDAI_CODEX_PATH`) in the workspace directory,
keeps the current thread id in app settings, resumes the saved thread on startup, and restarts the
app-server after unexpected exits. Each turn also gets lightweight active-browser context so the
model knows which tab the user is looking at.

Codex replays the whole thread to the model each turn, so the app keeps that history lean: tool
text is capped per result (JSON shrinks structurally so scripts can still parse it), screenshots
reach the model as a bounded JPEG while the transcript shows the full capture, pasted screenshots
are bounded before they are sent, and the app compacts once a turn ends above
`chatCompactAtPercent` (Codex itself compacts near the limit). The chat header shows how full the
context is, and "Continue in new chat" starts a fresh thread carrying only a digest of the current
one (`docs/tools.md`, "Results live in the thread history"). The composer's effort picker sends
`turn/start.effort` on every turn; left on "Default effort", a thread keeps the effort it was
created with (Codex persists it), even after `~/.codex/config.toml` changes.

gpt-5.6 models run in Codex "code mode": they reach every ClosedAI tool from JavaScript inside
Codex's `exec` tool, where a tool result is one string (an image arrives as a trailing data URL).
Tool descriptions and results spell out that contract; see `docs/tools.md`.

Tools are advertised to Codex as app-server `dynamicTools` on `thread/start` and `thread/resume`.
Codex calls them through `item/tool/call`; `src/main/tools/app-server-tools.ts` adapts that request
into the provider-neutral registry and returns text or image content. The Tools modal reads the
same registry through IPC, so the UI shows exactly what is currently advertised.
