# Simulation task catalog

Tasks describe **user simulation goals** the harness can replay (Phase A) or later drive with a
live model (Phase B). Each task lists a deterministic tool trace, an oracle, and optional
**variations** — a map of argument lists expanded as a Cartesian product for parallel runs.

## Files

- `embedded_browser.page.json` — pilot catalog for `embedded_browser.page` (see
  `docs/tool-harness-simulation-plan-2026-09-23.md`).
- `search.query.json` — quick search routing task with stub providers.
- `waived.json` — tools without tasks yet and why (see `catalog-coverage.test.ts`).
- `schema.json` — JSON Schema for validation (optional in CI).
- `*.draft.json` — output of `npm run harness:extract -- --write`; not loaded until promoted.

## Run locally

```sh
npm run harness:replay          # all *.json catalogs under harness/tasks/
npm run harness:model           # golden adapter (stub replay through model path)
npm run harness:codex           # live Codex turn (tasks with `user` only; concurrency 1)
npm run harness:compare         # A/B variant pass rates
npm run harness:extract         # dry-run draft tasks from tool tests
npm run harness:extract -- --write
```

Reports land in `harness/out/<run-id>/report.json`.
