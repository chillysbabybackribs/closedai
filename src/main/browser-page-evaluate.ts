import type { ScriptRunner } from './browser-page-ready.js'

// The two things models kept hand-rolling through raw Runtime.evaluate: run some JavaScript in
// the page and get a bounded, serialisable answer back; and ask "what matches this selector"
// and get structured facts per element. Both run through the WebContents the app owns, so no
// debugger attaches and the page keeps its ordinary state.

export type PageEvaluateRequest = {
  /** An expression, or statements with an explicit `return`. Promises are awaited. */
  expression: string
  maxChars: number
}

export type PageEvaluateResult =
  | { ok: true; type: string; value: unknown; truncated: boolean }
  | { ok: false; error: string }

export type PageQueryRequest = {
  selector: string
  /** Case-insensitive substring the element's text must contain. */
  text?: string
  /** Extra attributes to report per element. */
  attributes?: string[]
  visibleOnly: boolean
  limit: number
  maxText: number
}

export type PageQueryItem = {
  index: number
  tag: string
  id: string | null
  classes: string[]
  role: string | null
  name: string | null
  text: string
  value: string | null
  href: string | null
  src: string | null
  type: string | null
  disabled: boolean
  checked: boolean | null
  visible: boolean
  bounds: { x: number; y: number; width: number; height: number }
  attributes?: Record<string, string | null>
}

export type PageQueryResult = { selector: string; matched: number; returned: number; items: PageQueryItem[] }

/** Serialiser shared by both scripts: bounded depth and breadth, DOM nodes summarised, cycles cut. */
const SERIALIZE_SOURCE = `
  const seen = new WeakSet();
  const summarizeNode = (node) => {
    if (node.nodeType === 9) return { node: 'document', url: node.URL, title: node.title };
    if (node.nodeType !== 1) return { node: node.nodeName, text: String(node.textContent || '').trim().slice(0, 120) };
    return {
      node: node.tagName.toLowerCase(),
      id: node.id || null,
      classes: node.className && typeof node.className === 'string' ? node.className.trim().split(/\\s+/).filter(Boolean) : [],
      text: String(node.innerText || node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120)
    };
  };
  const serialize = (value, depth) => {
    if (value === undefined) return null;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (typeof value === 'bigint') return value.toString() + 'n';
    if (typeof value === 'function') return '[Function ' + (value.name || 'anonymous') + ']';
    if (typeof value === 'symbol') return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return { name: value.name, message: value.message, stack: String(value.stack || '').slice(0, 800) };
    if (typeof Node !== 'undefined' && value instanceof Node) return summarizeNode(value);
    if (depth >= 6) return '[Object]';
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (value instanceof Map) return serialize(Array.from(value.entries()), depth + 1);
    if (value instanceof Set) return serialize(Array.from(value.values()), depth + 1);
    if (typeof NodeList !== 'undefined' && (value instanceof NodeList || value instanceof HTMLCollection)) {
      return serialize(Array.from(value), depth + 1);
    }
    if (Array.isArray(value)) {
      const items = value.slice(0, 200).map((item) => serialize(item, depth + 1));
      if (value.length > 200) items.push('[' + (value.length - 200) + ' more]');
      return items;
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[' + value.constructor.name + ' ' + value.byteLength + ' bytes]';
    const out = {};
    let count = 0;
    for (const key of Object.keys(value)) {
      if (count++ >= 100) { out['…'] = 'more keys omitted'; break; }
      try { out[key] = serialize(value[key], depth + 1); } catch (error) { out[key] = '[unreadable]'; }
    }
    return out;
  };
`

export function evaluateScript(request: PageEvaluateRequest): string {
  return `(async () => {
  ${SERIALIZE_SOURCE}
  const source = ${JSON.stringify(request.expression)};
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  let run;
  try { run = new AsyncFunction('return (' + source + '\\n);'); }
  catch (error) { run = new AsyncFunction(source); }
  try {
    const value = await run();
    const text = JSON.stringify({ ok: true, type: typeof value, value: serialize(value, 0) });
    const limit = ${Math.max(1_000, request.maxChars)};
    if (text.length <= limit) return text;
    return JSON.stringify({ ok: true, type: typeof value, truncated: true, value: text.slice(0, limit) });
  } catch (error) {
    return JSON.stringify({ ok: false, error: String(error && error.stack ? error.stack : error).slice(0, 4000) });
  }
})()`
}

export function queryScript(request: PageQueryRequest): string {
  return `(() => {
  const selector = ${JSON.stringify(request.selector)};
  let nodes;
  try { nodes = Array.from(document.querySelectorAll(selector)); }
  catch (error) { return JSON.stringify({ error: 'Invalid selector: ' + String(error && error.message ? error.message : error) }); }
  const needle = ${JSON.stringify(request.text?.toLowerCase() ?? null)};
  const attributes = ${JSON.stringify(request.attributes ?? [])};
  const visibleOnly = ${request.visibleOnly ? 'true' : 'false'};
  const maxText = ${request.maxText};
  const clean = (value) => String(value == null ? '' : value).replace(/\\s+/g, ' ').trim();
  const describe = (node, index) => {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    const text = clean(node.innerText || node.textContent);
    const item = {
      index,
      tag: node.tagName.toLowerCase(),
      id: node.id || null,
      classes: typeof node.className === 'string' ? node.className.trim().split(/\\s+/).filter(Boolean) : [],
      role: node.getAttribute('role'),
      name: node.getAttribute('aria-label') || node.getAttribute('title') || node.getAttribute('alt') || node.getAttribute('placeholder') || null,
      text: text.length > maxText ? text.slice(0, maxText) + '…' : text,
      value: 'value' in node && typeof node.value === 'string' ? node.value.slice(0, maxText) : null,
      href: node.href && typeof node.href === 'string' ? node.href : null,
      src: node.currentSrc || (typeof node.src === 'string' ? node.src : null) || null,
      type: node.getAttribute('type'),
      disabled: node.disabled === true || node.getAttribute('aria-disabled') === 'true',
      checked: typeof node.checked === 'boolean' ? node.checked : null,
      visible,
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
    };
    if (attributes.length) {
      item.attributes = {};
      for (const name of attributes) item.attributes[name] = node.getAttribute(name);
    }
    return { item, text, visible };
  };
  const items = [];
  let matched = 0;
  nodes.forEach((node, index) => {
    const described = describe(node, index);
    if (needle && !described.text.toLowerCase().includes(needle)) return;
    if (visibleOnly && !described.visible) return;
    matched += 1;
    if (items.length < ${request.limit}) items.push(described.item);
  });
  return JSON.stringify({ selector, matched, returned: items.length, items });
})()`
}

export async function evaluateInPage(contents: ScriptRunner, request: PageEvaluateRequest): Promise<PageEvaluateResult | null> {
  if (contents.isDestroyed()) return null
  const raw = await contents.executeJavaScript(evaluateScript(request), true)
  return parseEvaluation(raw)
}

export async function queryInPage(contents: ScriptRunner, request: PageQueryRequest): Promise<PageQueryResult | null> {
  if (contents.isDestroyed()) return null
  const raw = await contents.executeJavaScript(queryScript(request), true)
  const parsed = parseJson(raw)
  if (parsed && typeof parsed.error === 'string') throw new Error(parsed.error)
  if (!parsed || !Array.isArray(parsed.items)) throw new Error('The page returned no query result')
  return parsed as unknown as PageQueryResult
}

export function parseEvaluation(raw: unknown): PageEvaluateResult {
  const parsed = parseJson(raw)
  if (!parsed) return { ok: false, error: 'The page returned no result' }
  if (parsed.ok === true) {
    return { ok: true, type: String(parsed.type ?? 'undefined'), value: parsed.value ?? null, truncated: parsed.truncated === true }
  }
  return { ok: false, error: typeof parsed.error === 'string' ? parsed.error : 'Evaluation failed' }
}

function parseJson(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null
  try {
    const value = JSON.parse(raw)
    return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}
