# ClosedAI engineering contract

This repository is intentionally modular. These rules apply to every human and model-authored change.

## Application context and documentation

ClosedAI has project-scoped chat panes with Codex, Claude Code, and Antigravity providers. Each
pane owns its conversations; the app browser is shared. Provider background tasks are distinct
from peer panes. Read `docs/application.md` for current behavior, ownership, and known gaps;
`docs/model-context.md` for model instructions and trust boundaries; and `docs/tools.md` for tools.
Dated research and QA documents retain observations and proposals, not automatic implementation
instructions or proof of current behavior.

When behavior or contracts change, update the relevant current guide and any model-facing
description that promises that behavior. Keep common product facts in
`src/main/chat-context/application-instructions.ts` and response style in
`articulation-instructions.ts`; provider instruction builders add adapter-specific details.
Regenerate the workspace index after adding/removing navigable files or changing IPC ownership.

## Architecture

- `src/main/`: Electron main-process adapters and application services. Keep orchestration thin; isolate protocol parsing and state machines.
- `src/preload/`: the narrow IPC bridge. Export only capabilities described by `src/shared/` contracts.
- `src/shared/`: dependency-free contracts and pure cross-process types. It must not import an application layer.
- `src/renderer/`: product features and view orchestration. It talks to the backend only through the preload API.
- `src/components/ui/`: reusable presentation primitives. These must remain backend-agnostic.
- `src/renderer/styles/<feature>/`: focused style modules. A parent stylesheet may be an import-only index.

Prefer a feature directory once a concern needs three or more files. Keep tests beside the module they verify. Do not create a second implementation when an existing module can be extended or extracted.

## Navigating this repository

Prefer knowing where a file is to searching for it. A generated repository map ships in every thread's context (`src/main/chat-context/workspace-map.ts`, derived by `scripts/repo-tree.mjs`, re-read from the checkout at thread start, held current by `npm run map:check`), so most paths are read off it or derived from a rule rather than looked up.

- **Derive the path from the naming rule.** A directory's dominant prefix is the rule: everything in `src/main/claude/` is `claude-*`, every side-drawer file is `drawer-*`, a test sits beside its module, and a feature stylesheet is `src/renderer/styles/<feature>/<concern>.css`.
- **A `data-ui` id names its file.** The id's family maps to the component that renders it, and every id is declared in `src/shared/ui-controls.ts`. That takes a control on screen to its source with no search at all.
- **Search is the fallback, not the first move.** When the map does not settle it — an exact string, an unfamiliar corner — `closedai_workspace.inspect find` locates it in one call and `outline` gives a file's shape plus the stylesheets defining its classes.
- **Renderer changes travel in pairs.** A component and the stylesheet rules for its classes are one change; `outline` names both.
- **Keep the map honest.** Add facts to it only through the generator, so `map:check` can prove them current. Never hand-write repository detail into trusted instructions: a stale map is worse than no map, because it is believed without checking.

## Model tools

- Keep model tools provider-agnostic under `src/main/tools/`; provider adapters only translate the shared contract.
- Extend an existing namespace and verb tool when its domain, result shape, and trust level match. Otherwise add the smallest new layer required.
- Keep read-only and mutating capabilities separate when their approval or trust requirements differ.
- Design read tools for model context, not raw transport completeness: offer scope/query/projection controls and fit useful results within their output budget before the generic serializer has to truncate them.
- For live-app work, prefer deterministic tools over DOM discovery: `closedai_app.state` for facts and assertions, `closedai_app.command` for actions that call the app's own services, and `closedai_app.ui` (by manifest control id) only when the real control must be exercised. Every interactive renderer control carries a `data-ui` id from `src/shared/ui-controls.ts`; add the id and its manifest entry together. Do not read renderer source merely to discover controls or selectors; inspect implementation only after runtime evidence identifies an unresolved failure.
- Group deterministic tool sequences into one model pass, suppress successful intermediate payloads that are consumed within the sequence, and return only evidence needed for the next decision.

## Hard hygiene limits

- React/TSX component: 450 physical lines
- TypeScript implementation: 675 physical lines
- Test: 525 physical lines
- Stylesheet: 675 physical lines
- Build script: 450 physical lines
- Source JSON: 375 physical lines

The byte caps and layer-boundary rules live in `scripts/hygiene-gate.mjs`; source-category byte budgets are 1.5× their original values alongside the line budgets above. At 80% of a limit, treat the warning as a prompt to review responsibility boundaries, not a demand to remove useful context or split cohesive code. Never minify source, compress formatting, raise a limit, add an exception, or disable a gate without explicit owner approval.

## Verification and Testing

Keep turns fast, focused, and token-efficient:

- **No pre-change baseline tests**: Never run tests, benchmarks, or whole-repo checks before making an edit. Jump directly into implementing the change.
- **Targeted verification only**: Verify changes with `npm run typecheck` and *only* the specific test file that exercises the edited code (e.g. `node --experimental-transform-types --import ./scripts/ts-resolve-hook-register.mjs --test "src/path/to/target.test.ts"`).
- **Never run the full test suite (`npm test` / `npm run check`) for routine edits**: Full repo test runs take 20+ seconds, generate massive outputs, and waste context. Only run full gates when preparing a release or when explicitly instructed by the user.
- **Hygiene checks**: Run `npm run hygiene` when modifying file lengths or structure to verify line limits.
