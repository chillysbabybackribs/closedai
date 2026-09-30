# Site discovery (`site.discover`)

Source review: 2026-09-30. **`bootstrap`** and **`expand`** actions.

## Purpose

Read-only **origin discovery** before the model commits tokens to whole-page reads or ad-hoc
fetches. Probes and expand fetches run in the main process on the **browser session partition**
(same cookies as `embedded_browser.session`), not inside a tab.

## Tool shape

| Namespace | Tool | Action | Trust |
|-----------|------|--------|-------|
| `site` | `discover` | `bootstrap`, `expand`, `apis` | Read-only GET; `deferLoading: true` |

## Action: bootstrap

One parallel probe pass builds a **site card** for an http(s) seed URL's origin.

### Input (summary)

- **`url`** (required) — absolute http(s) seed; origin drives probes.
- **`focus`** — optional keywords; rank sitemap `loc`s and same-origin nav links.
- **`channels`** — subset of `robots`, `sitemap`, `llms_txt`, `openapi`, `html`, `feeds` (default all).
- **`tab_id`** — optional; HTML channel reads the live tab when its URL shares the origin.
- Caps: `max_sitemap_urls`, `max_nav_links`, `max_llms_chars`, `max_probe_bytes`, `timeout_ms`.

Large HTML documents may exceed `max_probe_bytes`; the **html** channel still parses the **first**
`max_probe_bytes` of `text/html`. Other channels reject oversize bodies.
`html.fetch.parseTruncated` marks when the full response was larger.

### Execution order

1. **`robots`** runs first when enabled (feeds sitemap URLs into the sitemap channel).
2. Remaining channels run concurrently (pool of 6).

### Output

Structured JSON: `seed`, per-channel objects, deterministic **`hints`** (max 8 lines), and **`errors`**.

## Action: expand

After **bootstrap**, pass ranked **`urls`** (sitemap `loc`s, nav links, llms.txt hrefs) to fetch a
**bounded batch** of same-origin pages and return **prose excerpts** (HTML run through the same
text extractor as research sources).

### Input (summary)

- **`url`** (required) — seed URL; defines allowed origin (every `urls` entry must match).
- **`urls`** (required) — array of absolute same-origin URLs (max 40 listed).
- **`focus`** — optional; reorder `urls` before `max_pages`.
- **`max_pages`** — default 6, max 20 pages fetched after robots filtering.
- **`max_excerpt_chars`** — per page (default 2500).
- **`max_probe_bytes`**, **`timeout_ms`** — per-fetch and total budgets.
- **`respect_robots`** — default true; loads `/robots.txt` and skips disallowed paths (longest
  prefix Allow/Disallow match for `User-agent: *`).

### Output

`seed`, `requested`, `queued`, `fetched`, **`pages`** (url, title, excerpt, fetch meta,
optional `sparse` for script-heavy shells), **`skipped`** (`robots` | `over_cap`), **`errors`**.

Non-HTML bodies larger than `max_probe_bytes` are rejected; HTML may truncate like bootstrap.

## Action: apis

Summarize **`browser_cdp.instrument`** recordings on a tab into a ranked **endpoint map**
(fetch, XHR, WebSocket). Read-only: does not install hooks. Call **`instrument` `hook`** before
navigate/interaction, then **`apis`** with the same `tab_id`.

### Input (summary)

- **`tab_id`** (required)
- **`url`** (optional) — seed origin for `origin_only` filtering
- **`origin_only`** — drop cross-origin resolved URLs
- **`limit`** — max endpoints (default 30)

### Output

`installed`, `pageUrl`, `origin`, `channelCounts`, **`endpoints`** (method, resolvedUrl, count,
channels, lastAtMs), **`frames`**, deterministic **`hints`**, and `message` when no recorder.

## Implementation

`src/main/tools/site/` — `discover-probes.ts`, `bootstrap.ts`, `expand.ts`, `apis-map.ts`, `apis.ts`.

## Follow-ons (not implemented)

- **`summary`** — rolling per-tab/origin index for token-efficient turns.

See notepad note **Browser agent optimizations backlog** for the wider product backlog.
