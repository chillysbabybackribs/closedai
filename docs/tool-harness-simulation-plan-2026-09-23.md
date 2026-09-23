# Tool harness simulation and optimization plan

Status: design proposal for implementation and testing (not shipped behavior)  
Date: 2026-09-23

## Purpose

ClosedAI cannot today prove that a given **tool description + schema + shared instructions**
combination is optimal for the tasks each tool exists to support. Unit tests validate contracts;
live checks spot-check a few flows; [`model-harness-audit-2026-09-04.md`](model-harness-audit-2026-09-04.md)
explicitly calls for manual live comparisons and Turn Trace review—not systematic search.

This plan adds a **tool-centric harness simulator**:

1. For each tool (or action), record **what it is for** and **how the app uses it**.
2. Derive **tasks** (user goals that should invoke that tool correctly).
3. Run tasks against **stub backends** (fast, deterministic) and optionally **live** backends.
4. **Score** tool choice, arguments, order, and policy (batching, credentials, browser locks).
5. **Compare harness variants** (prompt/schema/description diffs) until scenario pass rates meet targets.

Priorities match the product contract: **correct tool behavior first**, latency and token cost second
in scoring weights.

## Non-goals (initial phases)

- No claim of “optimal” in a global sense—only better on an **explicit, versioned task catalog**.
- No automatic merge of winning prompts into `application-instructions.ts` without human review.
- No full Electron UI sim in v1; stub hosts first (same pattern as `browser.test.ts` harness).
- No replacement of existing registry, MCP bridge, or provider sessions.
- No standalone “eval LLM” as the primary oracle; **structural oracles** (tool name, args, state) first.

## Core loop (what we are building)

```text
TOOL_CATALOG + docs/tools.md + *.test.ts
        → task catalog (YAML/JSON)
        → sim fixture (host stubs + app state)
        → model run (provider API or recorded trace replay)
        → oracle score
        → harness variant diff (optional search)
        → report (pass rate, failures, cost)
```

The user’s simplification is the spec: **look at the tool → what it’s for → what the app uses it for →
run those tasks → optimize the harness for them.**

## Existing assets to reuse

| Asset | Use in harness sim |
| --- | --- |
| [`src/main/tools/catalog.ts`](src/main/tools/catalog.ts) | Human “what it’s for” (`summary`, `group`, `offEffect`) |
| [`src/main/tools/manifest.ts`](src/main/tools/manifest.ts) | Exported descriptions + schemas for variants |
| [`defineActionTool`](src/main/tools/action-tool.ts) | Action-level tasks and oracles |
| Module `*.test.ts` under `src/main/tools/` | **Ground-truth tasks**: args, errors, host call sequences |
| [`browser.test.ts` `harness()`](src/main/tools/browser/browser.test.ts) | Template for **sim hosts** (record calls, fake responses) |
| [`scripts/pdf-benchmark/run.mjs`](scripts/pdf-benchmark/run.mjs) | Case runner + scoring + JSON report pattern |
| [`ToolRegistry`](src/main/tools/registry.ts) | Same validation/dispatch as production |
| Instruction builders ([`docs/model-context.md`](model-context.md)) | Variant layers for Codex/Claude/Cursor/Antigravity |
| [`tool-telemetry.json`](src/main/tools/telemetry.ts) (optional) | Prioritize tasks by real `toolId` frequency (`npm run audit:docs`) |
| Turn Trace (manual / future export) | Seed tasks from failed production calls |

## Architecture

### 1. Task catalog (`harness/tasks/`)

One file per **tool id** (e.g. `embedded_browser.page.yaml`) or per **action** when verbs differ sharply.

Each **task** entry:

```yaml
id: read_open_pdf_page_2
tool: embedded_browser.page
action: read_page
intent: User wants text from page 2 of the PDF already open in their tab.
user: Read the PDF in my browser tab and summarize page 2.
fixture: browser/default_tabs_with_pdf
initial_state: { tabs: [{ id: tab-1, url: https://a.test/paper.pdf }] }
oracle:
  must_call:
    - { namespace: embedded_browser, tool: page, action: read_page, args: { pdf_page: 2 } }
  must_not_call:
    - { namespace: embedded_browser, tool: page, action: navigate }
  max_tool_calls: 4
tags: [pdf, read_only]
source: src/main/tools/browser/browser.test.ts
```

**Task sources (generation order):**

1. **Manual seed** — 2–3 tasks per pilot tool, written by hand.
2. **Test extraction** — script parses `registry.call({ ... arguments })` from co-located tests.
3. **Docs** — bullet scenarios from `docs/tools.md` for that tool.
4. **Telemetry** — top N real call shapes (args redacted) when telemetry file exists.

A small **`harness/tasks/README.md`** defines the schema; **`harness/tasks/schema.json`** validates CI.

### 2. Sim fixtures (`harness/fixtures/`)

Fixtures name a **host profile**, not the whole app:

- **`browser/`** — implements `BrowserToolHost` like `browser.test.ts`; deterministic tabs/text/PDF metadata.
- **`app/`** — stub `closedai_app.state` JSON shapes (selection, project_switch, browser coordination).
- **`search/`** — canned provider JSON (no network).
- **`neutral/`** — tools that need no host (schema-only misuse tasks).

Fixtures are **composable**: task references `fixture: browser/default` + optional `state overlay`.

Future: **trace replay** fixture loads recorded host call/response pairs from Turn Trace export.

### 3. Runner (`scripts/harness-sim/run.mjs` + `src/main/harness/`)

**Phase A — Oracle-only (no model):**  
Replay a **golden trace** (sequence of tool calls) through the registry + fixture; assert host
state and outputs. Proves fixtures and oracles before spending API credits.

**Phase B — Single-turn model:**  
One user message → expect one tool call (or small batch). Uses provider HTTP/API with:

- Frozen **harness bundle**: tool manifest slice + instruction snippets for one provider.
- **`HARNESS_VARIANT`** env or JSON file (description overrides, optional instruction append).

**Phase C — Multi-turn:**  
User message → model may call tools → stub returns → model continues until stop or step cap.
Scores full trajectory against `oracle.must_call` / ordering / `max_tool_calls`.

Runner outputs **`harness/out/<run-id>/report.json`**: per-task pass/fail, failure reason, token/tool counts.

Keep runner logic under **`src/main/harness/`** (typed, tested); **`scripts/harness-sim/run.mjs`** is a thin
entry (mirror `pdf-benchmark`).

### 4. Harness variants (`harness/variants/`)

Variants are **data**, not forks of the repo:

```json
{
  "id": "page-preamble-v2",
  "base": "main",
  "overrides": {
    "tools.embedded_browser.page.description": "…",
    "instructions.shared.append": "…"
  }
}
```

Comparison run:

```sh
node scripts/harness-sim/run.mjs --variant=main --variant=page-preamble-v2 --provider=codex --tasks=embedded_browser.page
```

**Phase D — Search (later):** mutate description fields and instruction paragraphs; hill-climb or
grid on failing tasks only; never auto-commit winners.

Instruction assembly for variants must go through the same builders as production (extract a
**`buildHarnessInstructions(provider, variant)`** helper from existing code paths) so variants
respect character budgets ([`model-efficiency-instructions.test.ts`](src/main/model-efficiency-instructions.test.ts)).

### 5. Scoring

| Check | Type | Example |
| --- | --- | --- |
| Correct tool/action | Hard fail | Used `navigate` when task requires `read_page` |
| Args match (exact or predicate) | Hard fail | Missing `pdf_page: 2` |
| Schema validity | Hard fail | Registry returns `usageResult` / `isError` |
| Policy | Hard fail | `credential_vault.read` inside batch; browser act without claim |
| Call count / latency / tokens | Soft score | Weighted penalty above threshold |

**Pass** = all hard checks pass; soft score for ranking variants that all pass.

## Implementation phases

### Phase 0 — Pilot tool (prove the pipe)

**Tool:** `embedded_browser.page` (rich actions, existing harness, clear misuse cases in tests/comments).

Deliverables:

- [ ] `harness/tasks/embedded_browser.page.yaml` — ≥6 tasks (from `browser.test.ts` + docs).
- [ ] `harness/fixtures/browser/default.yaml` + host factory shared with tests where possible.
- [ ] `src/main/harness/oracle.ts` — match `must_call` / `must_not_call` on call log.
- [ ] `src/main/harness/run-fixture.test.ts` — golden trace replay, no model.
- [ ] `scripts/harness-sim/run.mjs` — run catalog, write `report.json`.

**Exit criteria:** `node scripts/harness-sim/run.mjs --replay-only` passes 100% on pilot tasks.

### Phase 1 — Task catalog generator

- [ ] `scripts/harness-sim/extract-from-tests.mjs` — scan `src/main/tools/**/*.test.ts` for
      `registry.call` patterns; emit draft task stubs (human edits required).
- [ ] `catalog.test.ts` guard: every `TOOL_CATALOG` id has a task file or explicit `waived` list.
- [ ] Document mapping **`catalog.summary` → task intent** in task front matter.

**Exit criteria:** ≥80% of `reads-web` tools have ≥1 automated or hand-written task.

### Phase 2 — Model runner (one provider)

- [ ] `src/main/harness/model-run.ts` — Codex first (existing app-server or direct API—pick smallest
      integration that accepts dynamic tool list + instructions).
- [ ] Env: `CLOSEDAI_HARNESS_API_KEY` / use existing Codex CLI auth pattern documented in runner README.
- [ ] `--provider=codex --model=… --effort=…` flags.

**Exit criteria:** Pilot catalog ≥70% pass on **main** harness with manual review of failures
(mis-oracle vs real harness bug).

### Phase 3 — Second backend + live subset

- [ ] Add `--backend=live` for tasks marked `live_ok: true` (subset of browser live-check style).
- [ ] Claude or Cursor adapter for same catalog (parity metric).

**Exit criteria:** Report includes cross-provider pass rate for pilot + `search.query` (second tool).

### Phase 4 — Variant comparison

- [ ] `harness/variants/` format + runner multi-variant report.
- [ ] One intentional experiment (e.g. `embedded_browser.page` preamble fix from harness audit).

**Exit criteria:** Documented A/B shows measurable pass-rate or token delta on pilot tasks.

## File layout (proposed)

```text
harness/
  tasks/
    schema.json
    README.md
    embedded_browser.page.yaml
    search.query.yaml
    …
  fixtures/
    browser/
    app/
  variants/
    README.md
docs/
  tool-harness-simulation-plan-2026-09-23.md   # this file
scripts/
  harness-sim/
    run.mjs
    extract-from-tests.mjs
src/main/harness/
  oracle.ts
  fixture-host.ts
  run-catalog.ts
  model-run.ts
  types.ts
  *.test.ts
```

Keep **`harness/tasks`** and **`harness/fixtures`** as data (JSON schema line budget applies to JSON if large).

## Testing and CI

| Command | When |
| --- | --- |
| `node --experimental-transform-types --import ./scripts/ts-resolve-hook-register.mjs --test "src/main/harness/*.test.ts"` | Every harness code change |
| `node scripts/harness-sim/run.mjs --replay-only` | CI optional gate (fast); required locally before variant PRs |
| `npm run typecheck` | Harness TS changes |
| Full model run | **Not** default CI (cost); nightly or manual |

Add **`npm run harness:replay`** → replay-only script.

## Relationship to other docs

- Implements the “next live comparison” spirit of [`model-harness-audit-2026-09-04.md`](model-harness-audit-2026-09-04.md) in a repeatable form.
- Complements [`source-guided-task-execution-plan-2026-09-20.md`](source-guided-task-execution-plan-2026-09-20.md) (task/evidence for *users*); this plan is *tool harness* quality.
- Product behavior remains documented in [`tools.md`](tools.md) and [`application.md`](application.md); tasks must stay aligned when contracts change.

## Risks

| Risk | Mitigation |
| --- | --- |
| Oracle drift vs real app | Co-locate tasks with tests; live_ok subset; update tasks in same PR as tool changes |
| Model nondeterminism | Multiple seeds; score tool choice not prose; replay-only gate for fixtures |
| Cost | Replay-first CI; small catalogs; defer loading in variant tests |
| Variant bypassing budgets | Reuse instruction builders + existing efficiency tests |

## Open decisions (resolve in Phase 0)

1. **Codex entrypoint for Phase 2** — thread via app-server vs standalone script (prefer smallest diff).
2. **Task id granularity** — tool-level vs `tool.action` files (recommend action-level when `defineActionTool` verbs differ).
3. **Telemetry import** — optional v1 or Phase 1 requirement.

## Success definition for “we can test it”

Phase 0 complete when a contributor can:

1. Add a task YAML for `embedded_browser.page`.
2. Run `npm run harness:replay` and see pass/fail with clear oracle diffs.
3. Run one model-backed command, get `report.json`, and decide whether a description change helped—without reading the entire tool stack.

That is sufficient to **test the approach** before investing in full-catalog extraction and search.
