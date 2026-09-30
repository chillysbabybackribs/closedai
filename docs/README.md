# Documentation map

## Current guides (behavior and contracts)

These are the sources AGENTS.md treats as authoritative for implemented behavior:

| Guide | Owns |
|---|---|
| [Application guide](application.md) | Projects, chats, layout, browser chrome, persistence, ownership, known gaps |
| [Model context](model-context.md) | Native-provider baseline, per-turn context, trust boundaries, refresh workflow |
| [Tools](tools.md) | Tool registry, namespaces, batching, captures, coordination locks |
| [CDP tool foundation](cdp-tool-foundation.md) | Protocol transport, targets, semantic input, profiling/instrumentation |
| [Provider guides](claude-code.md) | Claude, [Antigravity](antigravity.md), [Cursor](cursor.md) lane contracts |
| [Native instrumentation](native-instrumentation.md) | Frida probe lifecycle and limits |
| [Auto-git](autogit.md) | Optional local snapshot service |

Root [README.md](../README.md) covers install/run and points here. [AGENTS.md](../AGENTS.md) is the
engineering contract for contributors.

Run **`npm run audit:docs`** to write a timestamped report under [docs/reports/](reports/) (report-only doc/tool drift checks; no automatic edits).

## Model context and tool token ownership

What reaches a provider, and when:

| Context | Owner | When / maintainer rule |
|---|---|---|
| Provider-native chat behavior | Provider session adapters | Provider-specific; native project instructions may also load through that provider. |
| Session guide | `src/main/chat-context/`, `scripts/agent-guide-outline.json` | Attached to a new provider thread or handoff, not every turn. Edit the outline and regenerate the guide. |
| Turn context and handoffs | `src/main/chat-context/` | The clock is attached every turn and notepad context on every notepad-chat turn; the ambient browser tab, the workspace ledger (regex-gated), and historical handoffs are conditional. Keep data scoped to the relevant turn. |
| Tool schemas and descriptions | `src/main/tools/**` | Provider-specific delivery and discovery. Schemas own arguments, defaults, and limits; link to them instead of copying. |
| Human guides | `docs/application.md`, `docs/tools.md` | Reference for people; guide text is not automatically sent to chats. |

The Tools modal **advertised tokens** sum enabled tool descriptions (see `toolManifest`). Deferred
tools (`deferLoading: true`) ship stubs until discovered — keep eager tool text minimal.

## Dated research and QA (evidence, not spec)

Filenames with dates or titles marked "research", "recon", "audit", "benchmark", or "backlog"
record observations, measurements, or proposals at a point in time. They do not override the current
guides when behavior diverges.

| Document | Typical use |
|---|---|
| [Adaptive multi-agent development blueprint](adaptive-multi-agent-development-blueprint.md) | User-guided, continuously evolving multi-agent development proposal |
| [parallel-web-research-2026-09-04.md](parallel-web-research-2026-09-04.md) | Parallel search design history |
| [model-harness-audit-2026-09-04.md](model-harness-audit-2026-09-04.md), [model-latency-audit-2026-09-04.md](model-latency-audit-2026-09-04.md) | Harness/latency measurements |
| [trace-research.md](trace-research.md), [codex-desktop-recon.md](codex-desktop-recon.md) | Provider/trace recon |
| [electron-browser-platform-review.md](electron-browser-platform-review.md) | Chromium/Electron sandbox and permission design record (2026-09-01) |
| [frida-capability-assessment-2026-09-20.md](frida-capability-assessment-2026-09-20.md) | Native instrumentation assessment |
| [source-guided-task-execution-plan-2026-09-20.md](source-guided-task-execution-plan-2026-09-20.md) | Implementation plan |
| [chat-spine-read-scope.md](chat-spine-read-scope.md) | `peer_chats.spine` design record (2026-09-30); [Tools](tools.md) owns the contract |
| [tool-task-slice-design-2026-09-29.md](tool-task-slice-design-2026-09-29.md) | Task tool slice design; implementation notes at its top, [Tools](tools.md) owns the contract |
| [reddit-multi-provider-landscape-2026-09-29.md](reddit-multi-provider-landscape-2026-09-29.md) | Multi-provider user landscape research |
| [tool-harness-simulation-plan-2026-09-23.md](tool-harness-simulation-plan-2026-09-23.md) | Historical prompt and tool optimization plan; its shared-prompt assumptions are retired |
| [ui-polish-backlog.md](ui-polish-backlog.md), [../design-qa.md](../design-qa.md) | Visual QA backlog |
| [design-mocks/](design-mocks/) | Dated static HTML layout and chrome explorations; not shipped product behavior |

When a guide and a dated document disagree, trust the guide after verifying in source.
