# Documentation map

## Current guides (behavior and contracts)

These are the sources AGENTS.md treats as authoritative for implemented behavior:

| Guide | Owns |
|---|---|
| [Application guide](application.md) | Projects, chats, layout, browser chrome, persistence, ownership, known gaps |
| [Model context](model-context.md) | Prompt assembly, per-turn context, trust boundaries, refresh workflow |
| [Tools](tools.md) | Tool registry, namespaces, batching, captures, coordination locks |
| [CDP tool foundation](cdp-tool-foundation.md) | Protocol transport, targets, semantic input, profiling/instrumentation |
| [Provider guides](claude-code.md) | Claude, [Antigravity](antigravity.md), [Cursor](cursor.md) lane contracts |
| [Native instrumentation](native-instrumentation.md) | Frida probe lifecycle and limits |
| [Auto-git](autogit.md) | Optional local snapshot service |

Root [README.md](../README.md) covers install/run and points here. [AGENTS.md](../AGENTS.md) is the
engineering contract for contributors.

Run **`npm run audit:docs`** to write a timestamped report under [docs/reports/](reports/) (report-only doc/tool drift checks; no automatic edits).

## Prompt and tool token ownership

What models pay for every turn:

| Cost | Owner | Maintainer rule |
|---|---|---|
| Shared product facts | `src/main/chat-context/application-instructions.ts` | One copy across lanes; do not restate in Markdown or per-tool prose |
| Batching / XML trust | `src/main/chat-context/product-instructions.ts` | Lane adapters import slices; avoid duplicating in `tools.md` |
| Tool schemas and descriptions | `src/main/tools/**` | Defaults and limits here; cross-link from guides instead of copying |
| Human guides | `docs/application.md`, `docs/tools.md` | Behavior and contracts for people; trim overlap with prompt source |

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
| [electron-browser-platform-review.md](electron-browser-platform-review.md) | Platform permission/sandbox review |
| [frida-capability-assessment-2026-09-20.md](frida-capability-assessment-2026-09-20.md) | Native instrumentation assessment |
| [source-guided-task-execution-plan-2026-09-20.md](source-guided-task-execution-plan-2026-09-20.md) | Implementation plan |
| [ui-polish-backlog.md](ui-polish-backlog.md), [../design-qa.md](../design-qa.md) | Visual QA backlog |
| [design-mocks/](design-mocks/) | Dated static HTML layout and chrome explorations; not shipped product behavior |

When a guide and a dated document disagree, trust the guide after verifying in source.
