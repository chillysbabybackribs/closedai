# closedai

An Electron 44 shell around one embedded Chromium browser and a Prompt Kit-powered Codex app-server chat. The browser is
the appv1 embedded browser (same tab strip, omnibox, downloads shelf, dark chrome, session
partition, cookie import, popup-to-tab routing), with none of appv1's agents, providers,
tools, settings, or sidebar. One long-lived local app-server process serves every chat turn.

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

- `src/main` — bootstrap (`index.ts`), `BrowserService` / `BrowserTab` (WebContentsView per
  tab, no debugger), session identity + cookie persistence + first-launch cookie import,
  downloads, tab-session/history/settings JSON stores, permission policy (allow-all, see
  `docs/electron-browser-platform-review.md` §0), popup bridge, context menus.
- `src/preload` — the `window.closedai` bridge (`src/shared/api.ts` is its type).
- `src/renderer` — `App.tsx` (titlebar controls, split, browser pane, composer), the browser
  pane family, and the CSS copied from appv1 unchanged.
- `docs/electron-browser-platform-review.md` — the Electron/Chromium docs review and the
  owner decisions the build follows.
- `THIRD_PARTY_NOTICES.md` — attribution for the Prompt Kit-derived chat components.

## State

`~/.config/closedai/`: `browser-tabs.json` (restored on launch), `browser-history.json`
(omnibox suggestions), `app-settings.json` (cookie-import latch and current Codex thread),
`code-cache/`, and Chromium's
`Partitions/browser` profile.
