# ClosedAI engineering contract

This repository is intentionally modular. These rules apply to every human and model-authored change.

## Architecture

- `src/main/`: Electron main-process adapters and application services. Keep orchestration thin; isolate protocol parsing and state machines.
- `src/preload/`: the narrow IPC bridge. Export only capabilities described by `src/shared/` contracts.
- `src/shared/`: dependency-free contracts and pure cross-process types. It must not import an application layer.
- `src/renderer/`: product features and view orchestration. It talks to the backend only through the preload API.
- `src/components/ui/`: reusable presentation primitives. These must remain backend-agnostic.
- `src/renderer/styles/<feature>/`: focused style modules. A parent stylesheet may be an import-only index.

Prefer a feature directory once a concern needs three or more files. Keep tests beside the module they verify. Do not create a second implementation when an existing module can be extended or extracted.

## Model tools

- Keep model tools provider-agnostic under `src/main/tools/`; provider adapters only translate the shared contract.
- Extend an existing namespace and verb tool when its domain, result shape, and trust level match. Otherwise add the smallest new layer required.
- Keep read-only and mutating capabilities separate when their approval or trust requirements differ.

## Hard hygiene limits

- React/TSX component: 300 physical lines
- TypeScript implementation: 450 physical lines
- Test: 350 physical lines
- Stylesheet: 450 physical lines
- Build script: 300 physical lines
- Source JSON: 250 physical lines

The byte caps and layer-boundary rules live in `scripts/hygiene-gate.mjs`. At 80% of a limit, treat the warning as a prompt to extract by responsibility. Never minify source, compress formatting, raise a limit, add an exception, or disable a gate to make a change pass without explicit owner approval.

## Completion gate

Run `npm run check` before handing off a change. A change is not complete until hygiene, type checking, tests, the production build, and the import-closure gate pass.
