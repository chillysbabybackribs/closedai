# closedai

ClosedAI is an Electron 44 workspace with an embedded Chromium browser and a chat surface
supporting Codex, Claude Code, Antigravity, and Cursor. Multiple chats can run in one project; the
sidebar selects which conversation is visible. All chats share the app's browser session.
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

| Provider | Runtime and sign-in | Optional executable override |
|---|---|---|
| Codex | `codex` on `PATH`; ChatGPT sign-in from the app | `CLOSEDAI_CODEX_PATH` |
| Claude Code | Pinned `@anthropic-ai/claude-agent-sdk` bundles its CLI; sign in with `claude` and `/login` | No external runtime binary required |
| Antigravity | `~/.local/bin/agy`, then `agy` on `PATH`; sign in with `agy` in a terminal | `CLOSEDAI_ANTIGRAVITY_BIN` |
| Cursor | `~/.local/bin/cursor-agent`, then `cursor-agent` on `PATH`; sign in with `cursor-agent login` | `CLOSEDAI_CURSOR_BIN` |

`CLOSEDAI_WORKSPACE` selects the initial working directory. Otherwise the app uses its saved
workspace or the application checkout on first launch. The composer's project menu can change
the directory after startup. Stop running chats before switching projects.

`scripts/launch-electron-vite.mjs` removes inherited GPU-offload and Electron identity variables
so development uses the Electron installed here. Approval prompts are disabled in all four
providers; the accepted browser permission and sandbox policy is recorded in
[the platform review](docs/electron-browser-platform-review.md).

## Current application and engineering references

- [Application guide](docs/application.md): projects, chats, browser behavior, component ownership,
  persisted state, and current limitations.
- [Model context](docs/model-context.md): shared instructions, provider injection points, trust
  boundaries, context budgets, and how documentation reaches models.
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

## Verification

For routine edits, use `npm run typecheck`, the specific tests exercising changed code, and
`npm run hygiene` for changed file lengths or structure. Run `npm run map` when navigable files
or IPC ownership change, then `npm run map:check`. For real Chromium browser paths against the
app's `HOME_URL`, run `npm run browser:live`. The full `npm run check` gate is for release
preparation or an explicit request; see [AGENTS.md](AGENTS.md).
