# Simulation task catalog

Tasks describe **user simulation goals** the harness can replay (Phase A) or later drive with a
live model (Phase B). Each task lists a deterministic tool trace, an oracle, and optional
**variations** — a map of argument lists expanded as a Cartesian product for parallel runs.

## Files

- `embedded_browser.page.json` — pilot catalog for `embedded_browser.page` (see
  `docs/tool-harness-simulation-plan-2026-09-23.md`).
- `schema.json` — JSON Schema for validation (optional in CI).

## Run locally

```sh
npm run harness:replay
node scripts/harness-sim/run.mjs --catalog=harness/tasks/embedded_browser.page.json --concurrency=16
```

Reports land in `harness/out/<run-id>/report.json`.
