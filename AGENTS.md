# ClosedAI engineering contract

This repository is intentionally modular. These rules apply to every human and model-authored change.

## Application context and documentation

Read `docs/application.md` for current behavior, ownership, and known gaps;
`docs/model-context.md` for model instructions and trust boundaries; and `docs/tools.md` for tools.
Dated research and QA documents retain observations and proposals, not automatic implementation
instructions or proof of current behavior.

When behavior or contracts change, update the relevant current guide and any model-facing
description that promises that behavior. Keep common product facts in
`src/main/chat-context/application-instructions.ts` and response style in
`articulation-instructions.ts`; provider instruction builders add adapter-specific details.
Regenerate the workspace index after adding/removing navigable files or changing IPC ownership.
Add facts to the map only through the generator, so `map:check` can prove them current, and never
hand-write repository detail into trusted instructions: a stale map is worse than no map, because
it is believed without checking.

## Architecture

- `src/main/`: Electron main-process adapters and application services. Keep orchestration thin; isolate protocol parsing and state machines.
- `src/preload/`: the narrow IPC bridge. Export only capabilities described by `src/shared/` contracts.
- `src/shared/`: dependency-free contracts and pure cross-process types. It must not import an application layer.
- `src/renderer/`: product features and view orchestration. It talks to the backend only through the preload API.
- `src/components/ui/`: reusable presentation primitives. These must remain backend-agnostic.
- `src/renderer/styles/<feature>/`: focused style modules. A parent stylesheet may be an import-only index.

Prefer a feature directory once a concern needs three or more files. Keep tests beside the module they verify. Do not create a second implementation when an existing module can be extended or extracted. A component and the stylesheet rules for its classes are one change; `outline` names both.

## Navigating this repository

Paths here are derivable, so derive one rather than searching for it: a directory's dominant prefix is the rule (`src/main/claude/` is `claude-*`, every side-drawer file is `drawer-*`), a test sits beside its module, a feature stylesheet is `src/renderer/styles/<feature>/<concern>.css`, and a `data-ui` id's family names the component that renders it. Inside ClosedAI a generated map states all of this per directory; outside it, the rules still hold.

## Model tools

- Keep model tools provider-agnostic under `src/main/tools/`; provider adapters only translate the shared contract.
- Extend an existing namespace and verb tool when its domain, result shape, and trust level match. Otherwise add the smallest new layer required.
- Keep read-only and mutating capabilities separate when their approval or trust requirements differ. A verb that arms state a caller cannot see owns its release, and `tool_batch` unwinds it when the plan around it fails.
- Design read tools for model context, not raw transport completeness: offer scope/query/projection controls and fit useful results within their output budget before the generic serializer has to truncate them.
- Every interactive renderer control carries a `data-ui` id from `src/shared/ui-controls.ts`; add the id and its manifest entry together. Do not read renderer source merely to discover controls or selectors.

## Hard hygiene limits

- React/TSX component: 450 physical lines
- TypeScript implementation: 675 physical lines
- Test: 525 physical lines
- Stylesheet: 675 physical lines
- Build script: 450 physical lines
- Source JSON: 375 physical lines

The byte caps and layer-boundary rules live in `scripts/hygiene-gate.mjs`; source-category byte budgets are 1.5× their original values alongside the line budgets above. At 80% of a limit, treat the warning as a prompt to review responsibility boundaries, not a demand to remove useful context or split cohesive code. Never minify source, compress formatting, raise a limit, add an exception, or disable a gate without explicit owner approval.

## Verification and Testing

- Verify with `npm run typecheck` and only the test file that exercises the edited code: `node --experimental-transform-types --import ./scripts/ts-resolve-hook-register.mjs --test "src/path/to/target.test.ts"`.
- Run `npm run hygiene` when changing file lengths or structure.
- Full gates (`npm test`, `npm run check`) are for releases or an explicit request; a routine edit does not earn one.
