# Docs and tool-telemetry auditor — inputs and report shape

Status: specification for a **report-only** maintainer workflow, 2026-09-22. An audit run
produces markdown findings; it does **not** edit tracked guides, model instructions, or the
generated workspace index automatically. Human or follow-up tasks apply fixes.

Parent context: [Agent workspace plan](../agent-workspace-plan.md). Implementation tasks
(`task-audit-v1`, `task-routine-trigger`) build on this spec.

## Outcome

Each audit emits one timestamped markdown report (path chosen by the implementer, e.g.
`docs/reports/` or userData) with the sections below. A developer who has never run the audit
before can follow the checklist in this file without inventing data sources.

## Ground-truth hierarchy

When sources disagree, resolve in this order after verifying in source:

1. **Running registry** — tool definitions, schemas, and descriptions under `src/main/tools/`.
2. **Model-facing prompt slices** — `src/main/chat-context/application-instructions.ts`,
   `articulation-instructions.ts`, and provider `*-instructions.ts` builders.
3. **Current human guides** — files listed in [Documentation map](../README.md) under “Current
   guides”.
4. **Dated research / QA** — filenames or titles with dates, “research”, “recon”, “audit”,
   “benchmark”, or “backlog”; observations only, not spec.

Never treat the generated workspace index, a past audit report, or chat transcripts as proof of
current behavior.

## Authoritative inputs

### Human guides and contracts

| Input | Role in audit |
| --- | --- |
| [AGENTS.md](../../AGENTS.md) | Engineering contract; doc update rules, verification expectations |
| [docs/README.md](../README.md) | Map of current vs historical docs; prompt/tool token ownership |
| [docs/application.md](../application.md) | Product behavior, persistence, ownership |
| [docs/model-context.md](../model-context.md) | Prompt assembly, trust boundaries |
| [docs/tools.md](../tools.md) | Registry behavior, namespaces, batching, limits |
| [docs/cdp-tool-foundation.md](../cdp-tool-foundation.md) | CDP transport and retain semantics |
| Provider guides (`claude-code.md`, `antigravity.md`, `cursor.md`) | Lane-specific tool exposure |
| [docs/native-instrumentation.md](../native-instrumentation.md) | Native instrument limits |
| [docs/research-library.md](../research-library.md) | UI/on-disk research library (no model tool) |
| [docs/autogit.md](../autogit.md) | Optional autogit service |

Scan these (and cross-links between them) for **stale claims**: tool ids, actions, IPC names,
file paths, or behavior that contradict the registry or prompt sources.

### Model prompt sources (not a substitute for `tools.md`)

| Input | Audit use |
| --- | --- |
| `src/main/chat-context/application-instructions.ts` | Shared product facts every lane sees |
| `src/main/chat-context/product-instructions.ts` | Batching / XML trust |
| `src/main/chat-context/*-instructions.ts` (provider adapters) | Lane-specific additions |

Flag text here that promises tools or limits not present in `src/main/tools/`.

### Tool registry (code)

| Input | Audit use |
| --- | --- |
| `src/main/index.ts` | **Authoritative assembly**: `createToolRegistry([...])` lists every namespace registered at runtime (including `research.namespace` from `createResearchRuntime`, not bare `searchTools()` alone). |
| `src/main/tools/index.ts` | Re-exports namespace factories |
| `src/main/tools/registry.ts` | `names()`, `switchableIds()`, `isEnabled()` |
| `src/main/tools/catalog.ts` | `TOOL_CATALOG`, `TOOL_GROUPS`, `READ_ONLY_TOOL_IDS` — Tools dialog copy and grouping |
| `src/main/tools/manifest.ts` | `toolManifest()` — what the Tools modal advertises |
| `src/main/tools/**` | Per-tool descriptions and JSON schemas (source of advertised tokens) |

**Enumerating tools for the report (do not hand-maintain a tool list in this spec):**

- Prefer **`registry.switchableIds()`** for every switchable id (`namespace.tool` or
  `namespace.tool.action`).
- Prefer **`registry.names()`** for top-level tool names.
- Compare **`Object.keys(TOOL_CATALOG)`** to `registry.names()`: catalog entries with no
  registered tool are stale; registered tools missing from `TOOL_CATALOG` still appear in the UI
  with generated labels (`catalogEntry` fallback).
- **`toolManifest(registry, providers)`** matches what the renderer Tools dialog shows (enabled
  flags, deferred stubs, action list).

For offline scripts, import the same namespace factories as `src/main/index.ts` and pass the
same stubs as existing tests (see `src/main/tools/json-schema-zod.test.ts`), or run against a
live app via `tools:manifest` (below).

### Generated workspace index (maintenance artifact)

| Input | Audit use |
| --- | --- |
| `src/main/tools/workspace/workspace-index.generated.ts` | File lists, IPC flow map, control families — **generated only** |
| `npm run map` / `npm run map:check` | Regenerate or verify index via `scripts/repo-tree.mjs` |

Do **not** quote long file lists from the index into audit reports as “current repo facts”; cite
the generator command and diff or `map:check` result if the index is out of date. Do not hand-edit
the generated file.

### Tool telemetry

Aggregate counters and recent failure notes — no arguments, results, or chat ids.

| Access | When to use |
| --- | --- |
| **IPC `tools:telemetry`** | Running ClosedAI: returns `ToolTelemetrySnapshot` (see `src/shared/tools.ts`). Wired in `src/main/tools/ipc.ts`; preload exposes `tools.telemetry()` per `src/shared/api.ts`. |
| **File read (dev)** | `tool-telemetry.json` under Electron **userData** (default Linux: `~/.config/closedai/tool-telemetry.json`). Same shape as snapshot; version field in persisted JSON (see `src/main/tools/telemetry.ts`). |
| **Legacy** | `tool-telemetry.jsonl` may exist on old profiles; opener migrates into JSON on load. |

Snapshot fields to use in reports:

- `stats[]`: `toolId`, `action`, `calls`, `failures`, `timeouts`, `misuses`, `lastCalledAt`,
  `lastFailedAt`
- `errors[]`: recent `ToolErrorNote` (tool, action, kind, message, timestamp)
- `totalCalls`, `since` — “unused since” is only meaningful relative to `since`

Optional: Tools dialog **Clear** invokes `tools:clearTelemetry` (resets counters; note in report
if the audit ran immediately after a clear).

### Historical / non-spec docs

Classify every `docs/*.md` not listed as a current guide in [docs/README.md](../README.md):

- **Keep as historical** — dated audits, blueprints, backlogs, design proposals; report should
  say “no change expected” unless they are linked from current guides as if authoritative.
- **Candidate for removal or merge** — describes removed tools or unfinished platforms with no
  live code path, and is not linked from README as evidence.
- **Design mocks** — `docs/design-mocks/*.html`, `src/renderer/tools-mockups.html`; UI experiments
  only; never treat mock tool ids as registered tools.

## Report sections (required)

Each audit report must include these headings (content may be “none found”):

### 1. Metadata

- Audit date (UTC), repo revision (`git rev-parse HEAD` if available), how telemetry was read
  (IPC vs file path), whether `map:check` was run.

### 2. Stale claims in current guides

Claims in **current guides** or **prompt sources** that contradict `registry.switchableIds()`,
tool descriptions, or implemented IPC/behavior. For each finding: document path (and section),
quoted claim (short), observed truth (registry line, schema, or source file), severity
(user-facing / model-facing / maintainer-only).

### 3. Missing or orphan documentation

- Registered tools (or actions) with no mention in `docs/tools.md` or `TOOL_CATALOG` where
  maintainers would expect copy.
- `TOOL_CATALOG` entries for tools no longer registered.
- Current guides linked from README that are missing on disk.

### 4. Tool telemetry — unused and failing

From the latest snapshot:

- **Zero calls** (or no call since `since`) for switchable ids that remain enabled in the
  manifest — candidate for deferral, consolidation, or doc demotion (not automatic removal).
- **High failure / misuse / timeout rates** relative to calls; include latest `errors[]`
  messages (redact secrets if any appear in messages).
- **Refused / disabled** patterns: tools with calls only in `misuses` may indicate doc or schema
  confusion rather than low value.

Compare telemetry ids to `switchableIds()`; ids in telemetry but not in registry indicate stale
telemetry or renamed tools.

### 5. Research and dated docs — historical classification

List dated or proposal docs reviewed and confirm each is either:

- Correctly treated as historical in README, or
- Incorrectly cited from current guides / AGENTS as spec (stale cross-link).

Do not rewrite historical docs in the audit; record recommended follow-ups.

### 6. Recommended follow-ups (non-binding)

Prioritized, human-sized tasks (doc edits, tool pruning proposals, catalog entries). No automatic
commits.

## Checklist (single audit run)

1. `git status` — note whether the tree is clean enough to attribute findings.
2. `npm run map:check` — record pass/fail; if fail, run `npm run map` in a separate change, not
   inside the report-only job unless explicitly scoped.
3. Build the tool id set from code (`switchableIds` / manifest) per **Tool registry** above.
4. Load telemetry via **running app IPC** or **userData file**.
5. Grep current guides and prompt sources for tool ids **removed** from registry (legacy names)
   and for **registry ids** absent from docs.
6. Walk [docs/README.md](../README.md) dated table; flag historical docs linked as current spec.
7. Write the report with all **Report sections**.
8. Do not modify `docs/application.md`, `docs/tools.md`, `docs/model-context.md`, or
   `application-instructions.ts` as part of the audit command.

## Verification of the auditor implementation (later task)

When `task-audit-v1` lands:

- `npm run typecheck` for touched scripts.
- Trial report contains at least three concrete findings drawn from real registry + telemetry data.
- Report path and invoke command documented in the report header or README.

## Out of scope

- Automatic doc commits, catalog edits, or tool registry changes.
- Provider-native tools (Cursor, Codex CLI, etc.) outside ClosedAI’s `src/main/tools/` registry.
- Full `npm test` / `npm run check` unless releasing the auditor itself.
