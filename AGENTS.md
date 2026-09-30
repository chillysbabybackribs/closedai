# ClosedAI engineering contract

This repository is intentionally modular. These rules apply to every human and model-authored change.

## Application context and documentation

Consult the relevant sections of `docs/application.md` for current behavior and ownership,
`docs/model-context.md` for provider context delivery and trust boundaries, and `docs/tools.md`
for tool contracts. Read only the sections needed for the task; these guides are reference
material, not a required full read on every change.
Dated research and QA documents retain observations and proposals, not automatic implementation
instructions or proof of current behavior.

When behavior or contracts change, update the relevant current guide and any model-facing
description that promises that behavior. Provider lanes attach `closedai.clock` every turn. Codex, Claude, and Antigravity attach the
session guide (`closedai.guide`) on a new provider thread or handoff; Cursor keeps its native
session policy without guide/ledger injection or automatic rotation — see `docs/model-context.md`.
Keep application facts in the current guides and capability details in the tools that expose them;
extend the guide outline when cold-start orientation changes.
Regenerate the workspace index after adding/removing navigable files or changing IPC ownership.
Add facts to the map only through the generator, so `map:check` can prove them current, and never
hand-write repository detail into trusted instructions: a stale map is worse than no map, because
it is believed without checking.
Edit `scripts/agent-guide-outline.json` and run `npm run guide:generate` when cold-start orientation
changes; `guide:check` proves the generated `closedai.guide` text is current.

## Architecture

- `src/main/`: Electron main-process adapters and application services. Keep orchestration thin; isolate protocol parsing and state machines.
- `src/preload/`: the narrow IPC bridge. Export only capabilities described by `src/shared/` contracts.
- `src/shared/`: dependency-free contracts and pure cross-process types. It must not import an application layer.
- `src/renderer/`: product features and view orchestration. It talks to the backend only through the preload API.
- `src/components/ui/`: reusable presentation primitives. These must remain backend-agnostic.
- `src/renderer/styles/<feature>/`: focused style modules. A parent stylesheet may be an import-only index.

Prefer a feature directory once a concern needs three or more files. Keep tests beside the module they verify. Do not create a second implementation when an existing module can be extended or extracted. A component and the stylesheet rules for its classes are one change.

## Navigating this repository

Use native file search and read tools to navigate this repository. Tests sit beside their modules;
feature stylesheets live under `src/renderer/styles/<feature>/`. The generated index is a maintenance
artifact, not injected model context or a replacement for native file tools.
Find candidate filenames first (`rg --files -g '*name*'`), then search content in the relevant
directory. `.rgignore` excludes generated workspace maps from default searches; pass an explicit
file path when inspecting them.

## Visual concept work

When a user asks to see visual variations inspired by an image, consider the image generation
skill before choosing an output medium. Use it for exploratory bitmap concepts; use HTML/CSS
when the user needs an interactive prototype or exact application controls. State which medium
produced each result so a browser capture is never presented as an image-generated concept.

## Model tools

- Keep model tools provider-agnostic under `src/main/tools/`; provider adapters only translate the shared contract.
- Extend an existing namespace and verb tool when its domain, result shape, and trust level match. Otherwise add the smallest new layer required.
- Keep read-only and mutating capabilities separate when their approval or trust requirements differ. A verb that arms state a caller cannot see owns its release, and `tool_batch` unwinds it when the plan around it fails.
- Design read tools for model context, not raw transport completeness: offer scope/query/projection controls and fit useful results within their output budget before the generic serializer has to truncate them.
- Every interactive renderer control carries a `data-ui` id from `src/shared/ui-controls.ts`; add the id and its manifest entry together. Do not read renderer source merely to discover controls or selectors.

## Hygiene review thresholds (advisory, not design targets)

- React/TSX component: 450 physical lines
- TypeScript implementation: 675 physical lines
- Test: 525 physical lines
- Stylesheet: 675 physical lines
- Build script: 450 physical lines
- Source JSON: 375 physical lines

Line and byte review thresholds live in `scripts/hygiene-gate.mjs`. Size alone never fails
hygiene or blocks development, builds, or CI. Dependency-layer violations remain hard failures.
The default report summarizes oversized files; `npm run hygiene -- --details` lists them when
that detail is useful. There are no near-threshold warnings or per-file waivers. Generated maintenance-index sizes
are also advisory; `map:check` still fails for stale data. The injected session guide retains its
separate context-size budget.

The implementing model may extend, extract, or simplify code based on cohesion, discoverability,
testability, and maintenance cost, without requesting permission for crossing a size threshold.
Prefer completing cohesive work. Extract when a distinct responsibility or useful boundary makes
behavior easier to understand and maintain; simplify when code is redundant or unnecessary.
Consider whether splitting would force readers to jump between tightly coupled fragments.
Never remove useful context, minify source, or compress formatting to satisfy a size measurement.

Review structure when the task meaningfully affects it. An existing large file does not create
an unrelated refactoring assignment. For substantial growth beyond a threshold, briefly explain
the structural choice in the normal change summary; no separate report or extra tool call is required.

## Verification and Testing

- For renderer UI work, run the real Electron app (`npm run build && npm run preview`, or
  `npm run dev` for hot reload). Do not add a second browser-only entry or duplicate bridge.

- Default verification: one co-located test via `npm run test:one -- src/path/to/target.test.ts`. Run
  `npm run typecheck` when shared types or cross-layer contracts change, not after every micro-edit.
- Run `npm run hygiene` when changing imports, module structure, or the gate itself, unless the
  same work will be checked by `npm run dev` or `npm run build`. Size-only growth needs no extra check.
- Adding a co-located test: run that test, run hygiene for the new module/imports (unless dev/build
  covers it), and run `npm run map` then `npm run map:check`. Inspect untracked files separately;
  ordinary `git diff` and `git diff --check` omit them. For a new file, use
  `git diff --no-index --check /dev/null path/to/file` to check whitespace without staging it.
- Choose the smallest meaningful verification set and run it once per logical edit batch. Reuse
  valid results from the current work; repeat only when relevant edits, failures, or new evidence
  justify it. Docs-only and comment-only changes need no code tests or typecheck.
- `dev` and `build` run hygiene automatically; `build` also typechecks. `check` relies on those
  build checks instead of repeating them. Do not run separate checks that the chosen workflow
  already covers for the same code state.
- Full gates (`npm test`, `npm run check`) are for releases or an explicit request; a routine edit does not earn one.
