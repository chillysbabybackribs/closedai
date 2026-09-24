# Tool harness simulation and optimization plan

**Historical (2026-09-23).** This is evidence and roadmap, not a spec for current behavior. When
this file disagrees with [Tools](tools.md), [Model context](model-context.md), or
[Application](application.md), trust those guides after checking source.

Shared-prompt layers (`application-instructions.ts` and similar) and harness-driven prompt search
described in the original plan are **retired** with the native-provider baseline. Tool quality work
now targets registry descriptions, the first-turn session guide (`closedai.guide`), and replay tasks.

## What shipped

- Phase 0 **replay harness**: task catalogs under [`harness/tasks/`](../harness/tasks/README.md),
  `npm run harness:replay`, coverage guarded by `src/main/harness/catalog-coverage.test.ts`.
- Report-only drift checks: `npm run audit:docs` (see [docs/reports/](reports/README.md)).
- Prior manual harness notes: [model-harness-audit-2026-09-04.md](model-harness-audit-2026-09-04.md).

## Full original text

The long-form plan (tasks, phases, file layout) was removed from the tree to avoid stale
instruction-builder references. Recover it from git when needed:

```sh
git show 31ae86fa:docs/tool-harness-simulation-plan-2026-09-23.md
```
