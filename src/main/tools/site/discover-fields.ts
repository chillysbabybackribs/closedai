import type { JsonObject } from '../tool.js'

/** Shared discover action fields — schemas must match exactly across bootstrap and expand. */
export const DISCOVER_URL_FIELD: JsonObject = {
  type: 'string',
  minLength: 1,
  description: 'Absolute http(s) seed URL; origin drives probes and expand fetches.'
}

export const DISCOVER_FOCUS_FIELD: JsonObject = {
  type: 'string',
  description: 'Keywords to rank sitemap locs, nav links, or expand urls.'
}

export const DISCOVER_MAX_PROBE_BYTES_FIELD: JsonObject = {
  type: 'integer',
  minimum: 10_000,
  maximum: 2_000_000,
  description:
    'Per-URL body cap (default 512000). Bootstrap html and expand HTML parse the first max_probe_bytes of text/html when the full document is larger.'
}

export const DISCOVER_TIMEOUT_MS_FIELD: JsonObject = {
  type: 'integer',
  minimum: 3000,
  maximum: 45_000,
  description: 'Total action budget in milliseconds.'
}

export const DISCOVER_RESPECT_ROBOTS_FIELD: JsonObject = {
  type: 'boolean',
  description: 'expand only: when true (default), load robots.txt and skip disallowed paths. Ignored by bootstrap.'
}
