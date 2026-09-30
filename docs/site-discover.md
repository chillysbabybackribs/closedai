# Site discovery (`site.discover`)

Source review: 2026-09-30. Proposal implemented as v0 **`bootstrap`** action.

## Purpose

One read-only call builds a **site card** for an http(s) seed URL's origin before the model
commits tokens to whole-page reads or ad-hoc fetches. Probes run in the main process on the
**browser session partition** (same cookies as `embedded_browser.session`), not inside a tab.

## Tool shape

| Namespace | Tool | Action | Trust |
|-----------|------|--------|-------|
| `site` | `discover` | `bootstrap` | Read-only GET; `deferLoading: true` |

## Input (summary)

- **`url`** (required) — absolute http(s) seed; origin drives probes.
- **`focus`** — optional keywords; rank sitemap `loc`s and same-origin nav links.
- **`channels`** — subset of `robots`, `sitemap`, `llms_txt`, `openapi`, `html`, `feeds` (default all).
- **`tab_id`** — optional; HTML channel reads the live tab when its URL shares the origin.
- Caps: `max_sitemap_urls`, `max_nav_links`, `max_llms_chars`, `max_probe_bytes`, `timeout_ms`.

## Execution order

1. **`robots`** runs first when enabled (feeds sitemap URLs into the sitemap channel).
2. Remaining channels run concurrently (pool of 6): llms.txt candidates, OpenAPI JSON candidates,
   HTML (tab or seed fetch), standalone feeds, sitemap expansion (default `/sitemap.xml` plus robots
   `Sitemap:` lines, up to three index children).

## Output

Structured JSON: `seed`, per-channel objects (`robots`, `llmsTxt`, `sitemap`, `openapi`, `html`,
`feeds`), deterministic **`hints`** (max 8 lines), and **`errors`** for probe failures.

Implementation: `src/main/tools/site/` (`discover-probes.ts`, `bootstrap.ts`).

## Follow-ons (not implemented)

- **`expand`** — bounded crawl with robots enforcement and excerpt store.
- **`apis`** — summarize `browser_cdp.instrument` recordings into an endpoint map.
- **`summary`** — rolling per-tab/origin index for token-efficient turns.

See notepad note **Browser agent optimizations backlog** for the full product backlog.
