# closedai

An Electron 44 workspace with two first-class panes: one embedded Chromium browser and one
Prompt Kit-powered Codex app-server chat. The browser is the appv1 embedded browser lineage
(same tab strip, omnibox, downloads shelf, dark chrome, session partition, cookie import, and
popup-to-tab routing). The chat is a local Codex app-server client with thread history, model
selection, approval handling, attachments, and ClosedAI-owned browser/capture/CDP tools.

One long-lived local app-server process serves every chat turn. The renderer only talks to the
main process through the typed `window.closedai` preload bridge.

## Run

```sh
npm install --include=dev   # devDependencies hold electron/vite; NODE_ENV=production skips them
npm run dev                 # electron-vite dev with hot reload
npm run build && npm run preview
npm run typecheck
npm run closure             # import-closure gate: fails if anything outside the allowlist is reachable
npm test
```

ClosedAI resolves `codex` from `PATH`. Set `CLOSEDAI_CODEX_PATH` to use a specific CLI
binary and `CLOSEDAI_WORKSPACE` to override the app-server working directory.

`scripts/launch-electron-vite.mjs` scrubs GPU-offload variables (hybrid-GPU Linux) and any
`ELECTRON_EXEC_PATH` / `ELECTRON_*` identity a parent Electron app exported, so the app always
runs on the Electron installed here.

## Layout

- `src/main` - bootstrap (`index.ts`), `ChatService`, `BrowserService` / `BrowserTab`
  (WebContentsView per tab), browser session identity + cookie persistence + first-launch
  cookie import, downloads, tab-session/history/settings JSON stores, permission policy
  (allow-all, see `docs/electron-browser-platform-review.md` section 0), popup bridge,
  context menus, and the model tool registry.
- `src/main/tools` - provider-agnostic tools. Current namespaces are `embedded_browser`
  (navigate/read/wait), `closedai_ui` (app/page screenshots), and `browser_cdp`
  (raw Chrome DevTools Protocol access).
- `src/preload` - the `window.closedai` bridge (`src/shared/api.ts` is its type).
- `src/shared` - dependency-free IPC contracts for browser, chat, tools, and shared types.
- `src/renderer` - `App.tsx`, the split workspace, browser pane, chat pane, history drawer,
  composer, attachment handling, screenshots, and the Tools modal.
- `docs/tools.md` - the model tool architecture, current namespaces, telemetry, and modal.
- `docs/cdp-tool-foundation.md` - lifecycle and usage notes for the raw CDP tool.
- `docs/electron-browser-platform-review.md` — the Electron/Chromium docs review and the
  owner decisions the build follows.
- `THIRD_PARTY_NOTICES.md` — attribution for the Prompt Kit-derived chat components.

## State

`~/.config/closedai/`: `browser-tabs.json` (restored on launch), `browser-history.json`
(omnibox suggestions), `app-settings.json` (cookie-import latch, current Codex thread, selected
model, and disabled tool ids), `tool-telemetry.jsonl` (recent tool calls), `code-cache/`, and
Chromium's `Partitions/browser` profile.

## Chat and tools

`ChatService` starts `codex` from `PATH` (or `CLOSEDAI_CODEX_PATH`) in the workspace directory,
keeps the current thread id in app settings, resumes the saved thread on startup, and restarts the
app-server after unexpected exits. Each turn also gets lightweight active-browser context so the
model knows which tab the user is looking at.

Tools are advertised to Codex as app-server `dynamicTools` on `thread/start` and `thread/resume`.
Codex calls them through `item/tool/call`; `src/main/tools/app-server-tools.ts` adapts that request
into the provider-neutral registry and returns text or image content. The Tools modal reads the
same registry through IPC, so the UI shows exactly what is currently advertised.
