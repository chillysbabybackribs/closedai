# Documentation map

## Current guides (behavior and contracts)

These are the sources AGENTS.md treats as authoritative for implemented behavior:

| Guide | Owns |
|---|---|
| [Application guide](application.md) | Projects, chats, layout, browser chrome, persistence, ownership, known gaps |
| [Model context](model-context.md) | Prompt assembly, per-turn context, trust boundaries, refresh workflow |
| [Tools](tools.md) | Tool registry, namespaces, batching, captures, coordination locks |
| [CDP tool foundation](cdp-tool-foundation.md) | Protocol transport, targets, semantic input, profiling/instrumentation |
| [UI preview](ui-preview.md) | `dev:web` workflow and fixture boundaries |
| [Provider guides](claude-code.md) | Claude, [Antigravity](antigravity.md), [Cursor](cursor.md) lane contracts |
| [Native instrumentation](native-instrumentation.md) | Frida probe lifecycle and limits |
| [Research library](research-library.md) | Saved paper index contracts |
| [Investigation artifacts](investigation-artifacts.md) | Durable artifact retention |
| [Auto-git](autogit.md) | Optional local snapshot service |

Root [README.md](../README.md) covers install/run and points here. [AGENTS.md](../AGENTS.md) is the
engineering contract for contributors.

## Dated research and QA (evidence, not spec)

Filenames with dates or titles marked "research", "recon", "audit", "benchmark", or "backlog"
record observations, measurements, or proposals at a point in time. They do not override the current
guides when behavior diverges.

| Document | Typical use |
|---|---|
| [parallel-web-research-2026-09-04.md](parallel-web-research-2026-09-04.md) | Parallel search design history |
| [model-harness-audit-2026-09-04.md](model-harness-audit-2026-09-04.md), [model-latency-audit-2026-09-04.md](model-latency-audit-2026-09-04.md) | Harness/latency measurements |
| [trace-research.md](trace-research.md), [codex-desktop-recon.md](codex-desktop-recon.md) | Provider/trace recon |
| [electron-browser-platform-review.md](electron-browser-platform-review.md) | Platform permission/sandbox review |
| [pdf-benchmark-2026-09-20.md](pdf-benchmark-2026-09-20.md) | PDF native vs OCR checks |
| [frida-capability-assessment-2026-09-20.md](frida-capability-assessment-2026-09-20.md) | Native instrumentation assessment |
| [source-guided-task-execution-plan-2026-09-20.md](source-guided-task-execution-plan-2026-09-20.md) | Implementation plan |
| [investigation-platform.md](investigation-platform.md), [recon-buildout.md](recon-buildout.md) | Investigation/recon notes |
| [ui-polish-backlog.md](ui-polish-backlog.md), [../design-qa.md](../design-qa.md) | Visual QA backlog |

When a guide and a dated document disagree, trust the guide after verifying in source.
