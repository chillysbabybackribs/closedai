# Codex desktop app recon (2026-09-02)

Findings from inspecting the installed OpenAI Codex desktop app on this machine. Sources: the deb
install at `/usr/lib/chatgpt`, the extracted `app.asar`, live process and socket state, the
Electron userData dir (`~/.config/Codex`), and the Codex home (`~/.codex`). The JS bundles are
minified, so anything marked "inferred" was read from strings and structure, not source.

License note: the app is proprietary. This document is for understanding architecture and
interoperating with the public `codex app-server` protocol. Do not copy bundled code or assets.

Scope note (2026-09-03): these are dated observations about the installed OpenAI desktop app,
not ClosedAI's feature list or a fresh version check. ClosedAI's current behavior and model
integration are documented in [Application](application.md) and [Model context](model-context.md).

## Identity

| Item | Value |
|---|---|
| Debian package | `chatgpt` 26.831.21537, brand `chatgpt`, flavor `prod`, build 7579 |
| Electron package | `openai-codex-electron`, productName `Codex` |
| Electron | 42.3.0 custom fork ("owl" runtime), Chromium 152.0.7977.64 |
| Build | pnpm monorepo (`openai/openai` → `codex/codex-apps/electron`), electron-forge, Vite 8, TypeScript 7, vitest, oxlint/oxfmt |
| Bundled agent | `resources/codex` = codex-cli 0.152.1, static musl Rust binary (255 MB) |
| Helper binaries | `codex-code-mode-host` (Rust, 67 MB), `rg`, `cua_node` (Node 24.19.0 + `@oai/*` packages, 296 MB) |

## Process topology (observed live)

```
ChatGPT (Electron main, --user-data-dir ~/.config/Codex)
├─ renderers: main window, in-app browser pages, browser sidebar
├─ network service: --owl-scoped-user-agent-prefix=CodexBrowser for openai.com / chatgpt.com hosts
├─ worker_threads: worker.js (git worker, capnweb RpcTarget over MessagePort)
├─ resources/codex -c features.code_mode_host=true app-server --analytics-default-enabled
│      -c mcp_servers.codex_app={command=plugins/codex-app-tools/scripts/launch_codex_app_tools_mcp ...}
│   ├─ codex-code-mode-host            (stdio or grpc://; optional OTLP trace export)
│   ├─ cua_node/bin/node .../unified-computer-use/scripts/launch.mjs   (cua_repl MCP: js, js_reset)
│   ├─ cua_node/bin/node_repl          (node_repl MCP from config.toml; trusted services: browser, sky)
│   └─ node server.mjs                 (codex_app MCP; talks back to Electron over a unix socket)
└─ second `codex app-server --listen stdio://` (plugin app-server, ~/.codex/plugins/.plugin-appserver)
```

Sockets the Electron main listens on: `~/.codex/ipc/ipc.sock` and one
`/tmp/codex-browser-use/<uuid>.sock` per MCP consumer (passed as `CODEX_APP_TOOLS_PIPE_PATH`).
This is the reverse channel: the model calls MCP tools in `server.mjs`, which forwards to the app.

Custom URL schemes registered on every renderer: `app` (bundle host), `codex-sandbox`
(MCP Apps widgets), `sentry-ipc`.

## Renderer stack

React with Jotai atoms (persisted to `~/.codex/.codex-global-state.json` under
`electron-persisted-atom-state`) plus some zustand. Tailwind v4 (layer order set in `index.html`),
Slate for the composer, shiki, xterm, mermaid, d3, recharts, react-router, radix, floating-ui,
framer-motion, WebRTC for realtime voice. Two entry chunks: `app-initial` (10 MB) and
`app-primary` (7.8 MB), 7891 asset files including per-locale chunks, .NET/OpenXml WASM for
document rendering, worker runtimes, and a mascot spritesheet ("hoots").

Renderer webPreferences (inferred from main): nodeIntegration off, contextIsolation on,
webSecurity on, webviewTag off, plugins off.

## IPC and bridge design

The preload exposes only `window.electronBridge` and `window.codexWindowType`. There is no
per-feature channel list. The whole surface is:

- `codex_desktop:message-from-view` (invoke) and `codex_desktop:message-for-view` (push). Pushed
  messages are re-dispatched as a window `MessageEvent`, so renderer code listens with the DOM API.
- Chunked message protocol `codex-host-chunked-message-v1`: large payloads stream as JSON tokens
  (`object-start`, `key`, `string-chunk`, ...) with per-transfer acks. This is how big thread
  histories reach the view without blocking.
- "Shared objects": main owns key/value state, the view reads a synchronous snapshot at boot and
  receives `shared-object-updated` deltas. Keys seen: `statsig_default_enable_features`,
  `codex_runtimes_config`.
- Worker channels `codex_desktop:worker:<id>:from-view|for-view` for direct view to worker traffic.
- `codex_desktop:connect-app-host`: the view posts a MessagePort to main, which becomes a capnweb
  RPC session (`RpcTarget`/`RpcStub` present in main, worker, and renderer).
- MCP Apps sandbox: `sandbox-preload.js` handshakes a set of named MessagePorts (`navigate`,
  `setTheme`, `setWidgetData`, `notifyMcpAppsToolResult`, `runWidgetCode`, ...) for widgets served
  from `https://web-sandbox.oaiusercontent.com` or `codex-sandbox:` ("skybridge").
- Sync bootstrap reads: Sentry options, build flavor, system theme, initial sidebar bootstrap.

### App-server access from the renderer

Main hosts an "app-server-manager" that multiplexes app-server connections behind the virtual URL
`ws://codex-app-server/rpc`. It has status subscriptions, a population lease (start the local
server only while something needs it), per-account sources, and remote sources over SSH
(`~/.codex/app-server-control/`, forwarded ssh-agent socket, `codex app-server daemon bootstrap`,
remote install timeout). The renderer speaks app-server v2 JSON-RPC directly through it.

Renderer-used methods that are not in the exported schema: `thread/startAeon`,
`thread/turns/listLive`, `thread/search`, `thread/searchOccurrences`, `thread/memoryMode/set`,
`thread/settings/update`, `thread/stop`. Treat these as unstable.

## App-server protocol surface (v2, from `codex app-server generate-json-schema`)

98 client request methods and 81 server notifications. Groups: `account/*` (login, rate limits,
usage, credits), `thread/*` (start, resume, fork, revert, rollback, compact, goals, sections,
inject_items, shellCommand), `turn/*` (start, steer, interrupt), `command/exec/*` (pty style
exec with write and resize), `fs/*` (read, write, watch), `config/*`, `plugin/*` and
`marketplace/*`, `skills/*`, `hooks/list`, `mcpServer/*` (oauth, tool call, resource read),
`review/start`, `externalAgentConfig/*` (import from other agents), `windowsSandbox/*`,
`experimentalFeature/*`. Notification families include item deltas, reasoning deltas, plan
deltas, guardian approval review, hooks, realtime voice (SDP and audio deltas), remote control
status, thread queue and environment connect/disconnect.

Full schema dump and TypeScript generator: `codex app-server generate-json-schema --out DIR` and
`codex app-server generate-ts`.

## Feature flags worth knowing (`codex features list`)

Stable and on: apps, browser_use (+external, full_cdp_access), code_mode_host, computer_use,
guardian_approval, hooks, in_app_browser, in_app_chat, in_app_dictation, in_app_local_automation,
in_app_updates, multi_agent, plugins, plugin_sharing, remote_plugin, shell_snapshot, skill_search,
tool_suggest, unified_exec, workspace_dependencies, image_generation, fast_mode, goals,
personality. Under development: code_mode, realtime_conversation, enable_mcp_apps, transcript_v2,
token_budget, deferred_executor, guardianv2, memories (stable but off here).

## Persistence

Rust side (sqlx migrations, in `~/.codex`): `state_5.sqlite` (threads, projects, thread_sections,
thread_dynamic_tools, thread_spawn_edges, remote_control_enrollments, rollout migration),
`thread_history_1.sqlite` (thread_turns, thread_items with rollout byte offsets, realtime items),
`logs_2.sqlite`, `memories_1.sqlite`, `goals_1.sqlite`, `queue_1.sqlite`, plus `sessions/`
rollouts, `shell_snapshots/`, `history.jsonl`, `models_cache.json`.

Electron side (better-sqlite3, `~/.codex/sqlite/codex-dev.db`): `automations` (RRULE cron, model,
target thread, execution environment), `automation_runs`, `inbox_items`, `local_thread_catalog`
with scan checkpoints and sync watermarks per host, `thread_timeline_ledger` (append-only per host
and thread), `local_app_server_feature_enablement`.

Config: `~/.codex/config.toml` is written by the app (a `[desktop]` table, plugin enablement,
marketplaces, the `node_repl` MCP server with its env). Auth: `~/.codex/auth.json` holds ChatGPT
OAuth id, access, refresh tokens and account id.

## Plugins, skills, runtimes

Bundled marketplace `openai-bundled` (local): codex-app-tools, sites, browser, unified-computer-use,
chrome, latex, deep-research, visualize, user-writing. Each plugin has `.codex-plugin/plugin.json`
with interface metadata, optional `skills/`, `mcpServers` (`.mcp.json`), `apps`, and hooks
(the browser and chrome plugins register a `Stop` hook that calls `node_repl.turn_ended`).

Curated remote marketplace: github, gmail, stripe, figma, product-design, deep-research-work,
plugin-management, openai-templates, plus connector apps by id.

Primary runtime (`~/.cache/codex-runtimes/codex-primary-runtime`, 1.8 GB, auto-updated with
jitter): Python 3.12.13, Node 24.19.0, LibreOffice headless, poppler, libheif, git. Serves the
documents, pdf, spreadsheets, presentations, and template-creator plugins.

`cua_node` packages: `@oai/browser-desktop` (in-app browser runtime), `@oai/cua`, `@oai/sky`
(computer use, uses Statsig), playwright, sharp, tesseract.js, pdfjs, pixelmatch, level DB.

The `node_repl` MCP is a persistent JavaScript session. The model writes JS against `cua.*` and
`browser` objects instead of calling many small tools. Trusted code paths and services are
passed by env (`NODE_REPL_TRUSTED_SERVICES`, `NODE_REPL_TRUSTED_CODE_PATHS`).

## Browser, Chrome, computer use

- In-app browser uses its own Chromium profile dir `~/.config/Codex/codex-browser-app`, a
  `browser-page-preload.js` injected into pages, per-session origin allowlists in
  `~/.codex/browser/sessions/*.toml`, WebMCP support, an accessibility tree extractor shipped as
  WASM, and a chat sidebar whose state lives in `browser-sidebar-page-states.json`. The exact
  native view type is not confirmed from the minified bundle (webview tag is disabled, so it is
  BrowserWindow or a child view positioned with `setBounds`).
- External Chrome and Edge control goes through a native messaging host
  (`com.openai.codexextension`, registry in `~/.codex/chrome-native-hosts-v2.json`) and an
  `extension-host` binary paired with published store extensions.
- Computer use overlays "ChatGPT is using your computer" (`~/.codex/computer-use/config.json`).

## Other subsystems found in the main bundle

- Language servers: typescript-language-server, pyright, rust-analyzer (GitHub download),
  kotlin-server (JetBrains CDN), jdtls. Main uses vscode-jsonrpc and the LSP client protocol.
- node-pty terminal, @parcel/watcher file watching, yjs CRDT, ws, smol-toml, ssh-config, tar,
  extract-zip, zod.
- Native: `hid-topology-watcher.node`, `@worklouder/device-kit-oai` (hardware device kit).
- Telemetry: Sentry (electron and node), OpenTelemetry traces via OTLP, Datadog logger, Statsig
  gates, crash reports under userData.
- Updates: Linux via apt and dpkg checks, macOS DMG from an Azure blob CDN, separate primary
  runtime updater.
- Payments partitions (`codex-checkout`, `codex-credit-*`) load Stripe and PayPal.
- App launchers: icons and detection for VS Code, Cursor, Zed, JetBrains IDEs, Warp, kitty, and
  others under `webview/apps`.
- Realtime voice and dictation via WebRTC with SDP exchanged over `thread/realtime/*`.
- Tray, global shortcuts, avatar overlay, picture-in-picture host, pet renderer windows.

## Where ClosedAI stands and how to build toward this

ClosedAI already has: a stdio `AppServerClient`, a provider hub (codex, claude, antigravity),
a provider-agnostic tool registry advertised through `dynamicTools`, an embedded browser with CDP
access, and chat peers. The gaps versus the Codex app, in the order that pays off soonest:

1. **Typed protocol.** Generate bindings with `codex app-server generate-ts` from the pinned
   binary and build the client on them. Track the v2 method list above, ignoring the unexported
   `thread/startAeon` family.
2. **App-server manager.** One shared server per host with a lease model instead of one child per
   window. Local first (`--listen unix://`), then the daemon commands
   (`codex app-server daemon start|stop|version`) so the CLI and app share threads.
3. **Bridge shape.** Replace per-feature IPC with a single from-view/for-view bus, a shared-object
   snapshot for main-owned state, and chunked streaming for large payloads. This keeps
   `src/preload/index.ts` narrow as features grow.
4. **App-owned persistence.** A better-sqlite3 catalog and append-only timeline ledger keyed by
   host and thread, fed by notifications. This is what makes history, search, and inbox cheap.
5. **Reverse channel.** A local MCP server injected via `-c mcp_servers.closedai_app=...` with a
   unix socket back to main, for tools that must outlive a thread (create thread, send message,
   fork, handoff). Keep `dynamicTools` for per-thread tools.
6. **Plugins, skills, hooks UI.** Read-only first: `plugin/list`, `skills/list`, `hooks/list`,
   `mcpServerStatus/list`, `config/read`. Then enablement through `config/batchWrite`.
7. **Automations and inbox.** RRULE schedules stored app-side, runs started with `thread/start`,
   results surfaced as inbox items.
8. **Code mode.** Turn on `features.code_mode_host`, and consider a persistent JS REPL MCP with
   trusted services for browser and computer control, the same shape as `node_repl`.
9. **Later.** Remote environments over SSH, realtime voice, LSP-backed code intelligence, and an
   MCP Apps sandbox with a MessagePort handshake.

## Reproducing this recon

```
npx @electron/asar extract /usr/lib/chatgpt/resources/app.asar /tmp/codex-recon/asar
/usr/lib/chatgpt/resources/codex features list
/usr/lib/chatgpt/resources/codex app-server generate-json-schema --out /tmp/codex-recon/schema
ss -xlp | grep -iE 'codex|chatgpt'
sqlite3 'file:~/.codex/sqlite/codex-dev.db?mode=ro&immutable=1' .schema
```
