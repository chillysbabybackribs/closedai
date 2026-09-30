# closedai

ClosedAI is an Electron 44 workspace with an embedded Chromium browser and a chat surface
supporting Codex, Claude Code, Antigravity, and Cursor. Multiple chats can run in one project; title-bar search and History find saved chats, and the
layout can show several chats at once. All chats share the app's browser session.
Project selection restores that directory's open chats and model preferences.

The renderer talks to the main process through the typed `window.closedai` preload bridge.
Models use a provider-independent tool registry to inspect and operate the application,
browse pages, capture images, search the web, and read other chats.

## Run

```sh
npm install --include=dev   # Electron and Vite are devDependencies
npm run dev                # electron-vite development build with hot reload
npm run build && npm run preview
```

The Chromium sandbox is on by default. When running from this checkout on a kernel that restricts
unprivileged user namespaces, the npm-installed `chrome-sandbox` helper is not SUID, so the
launcher detects that case, starts without the sandbox, and prints the one-time `chown`/`chmod`
fix. `CLOSEDAI_NO_SANDBOX=1` forces the opt-out on any machine. Packaged builds install the helper
correctly and are unaffected.

| Provider | Runtime and sign-in | Optional executable override |
|---|---|---|
| Codex | `codex` on `PATH`; ChatGPT sign-in from the app | `CLOSEDAI_CODEX_PATH` |
| Claude Code | Pinned `@anthropic-ai/claude-agent-sdk` bundles its CLI; sign in with `claude` and `/login` | No external runtime binary required |
| Antigravity | `~/.local/bin/agy`, then `agy` on `PATH`; sign in with `agy` in a terminal | `CLOSEDAI_ANTIGRAVITY_BIN` |
| Cursor | `~/.local/bin/cursor-agent`, then `cursor-agent` on `PATH`; sign in with `cursor-agent login` | `CLOSEDAI_CURSOR_BIN` |

`CLOSEDAI_WORKSPACE` selects the initial working directory. Otherwise the app uses its saved
workspace or the application checkout on first launch. The composer's project menu can change
the directory after startup. Manual project switches keep running chats in their original
directories; model-requested deferred switches wait for all chats to become idle.

`scripts/launch-electron-vite.mjs` removes inherited GPU-offload and Electron identity variables
so development uses the Electron installed here. Approval prompts are disabled in all four
providers; the accepted browser permission and sandbox policy is recorded in
[the platform review](docs/electron-browser-platform-review.md).

## Current application and engineering references

See [Documentation map](docs/README.md) for how current guides relate to dated research notes.

- [Application guide](docs/application.md): projects, chats, browser behavior, component ownership,
  persisted state, and current limitations.
- [Model context](docs/model-context.md): the native-provider baseline, turn context, trust
  boundaries, and how enabled tools reach models.
- [Tools](docs/tools.md): registry, all advertised namespaces, batching, captures, telemetry, and trace.
- [CDP](docs/cdp-tool-foundation.md): protocol access, target sessions, semantic page controls, and input visibility.
- [Claude Code](docs/claude-code.md), [Antigravity](docs/antigravity.md), and [Cursor](docs/cursor.md): provider lifecycle and protocol contracts.
- [Engineering contract](AGENTS.md): architecture, navigation, hygiene limits, and verification rules.
- [Auto-git](docs/autogit.md): optional local snapshot service.
- [Third-party notices](THIRD_PARTY_NOTICES.md): attribution for the Prompt Kit-derived components.

The [Electron review](docs/electron-browser-platform-review.md),
[Codex desktop recon](docs/codex-desktop-recon.md), and [trace research](docs/trace-research.md)
retain dated observations and proposals. They are evidence for past decisions; current behavior
is documented in the application, model-context, and tool guides.

## Focused verification

Pick the smallest meaningful checks, run them once per logical edit batch, and reuse passing
results until relevant edits, failures, or new evidence require a rerun. Docs-only and
comment-only changes need no tests or typecheck.

**One co-located test (default for code changes):** tests live beside the module they cover.

```sh
npm run test:one -- src/path/to/module.test.ts
```

**Typecheck:** run `npm run typecheck` when shared types, exports, or cross-layer contracts
change—not after every micro-edit. `npm run build` already typechecks; `npm run check` relies
on that build step instead of repeating it.

**Hygiene:** run `npm run hygiene` when imports, module structure, or `scripts/hygiene-gate.mjs`
change, unless `npm run dev` or `npm run build` will cover the same state. Dependency-layer
violations fail; oversized-file reports are advisory and size-only growth needs no extra command.
`dev` and `build` run hygiene automatically.

**Renderer UI:** verify in the real Electron app (`npm run build && npm run preview`, or
`npm run dev` for hot reload). Do not add a browser-only entry or duplicate the preload bridge.
Main-process or preload changes require an app restart; confirming the build succeeded is not the
same as checking the surface you changed—see [Application guide](docs/application.md).

**Workspace index:** when navigable files or IPC ownership change, run `npm run map` then
`npm run map:check`.

For real Chromium browser paths against the app's `HOME_URL`, run `npm run browser:live`.
`npm test` and `npm run check` are for release preparation or an explicit request; see
[AGENTS.md](AGENTS.md).
