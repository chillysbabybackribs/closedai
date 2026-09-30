/** Shared footer text when tool results hit MAX_RESULT_TEXT_CHARS or per-tool max_chars. */

export const GLOBAL_TRUNCATION_ADVICE =
  'Narrow the request (selector, json_path/fields/limit, url_contains, after_cursor, smaller limit). ' +
  'JSON: embedded_browser.script extract or session.fetch projection; HTML docs: session.fetch format:text or read_page selector; ' +
  'response bodies: browser_cdp.protocol body — not another whole-page read_page.'

export const READ_PAGE_TRUNCATION_ADVICE =
  'Pass a CSS selector, lower max_chars with a tighter scope, or use session.fetch format:text / script extract for APIs.'

export const SESSION_FETCH_TRUNCATION_ADVICE =
  'Use json_path, fields, and limit on JSON; format:text on HTML; raise max_chars only after projecting.'

export const SCRIPT_EXTRACT_TRUNCATION_ADVICE =
  'Tighten path, fields, or limit; prefer session.fetch when the API is cross-origin from the tab.'
