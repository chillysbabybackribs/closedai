// What a page does before an agent can look at it is normally unobservable: by the time any
// tool evaluates script, the site has already read cookies, fingerprinted the device, and made
// its first requests. `Page.addScriptToEvaluateOnNewDocument` runs ahead of the page's own code
// and survives navigation, so the recorder below wraps the APIs that matter and answers "what
// did this site actually do, from its first instruction" — with the counting done in the page
// and only a bounded fold shipped back.

export type InstrumentSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>

export const INSTRUMENT_CHANNELS = [
  'fetch', 'xhr', 'websocket', 'cookie', 'storage', 'eval', 'fingerprint', 'error'
] as const

export type InstrumentChannel = typeof INSTRUMENT_CHANNELS[number]

export const DEFAULT_CAPACITY = 500

export function channelsFrom(requested: string[]): InstrumentChannel[] {
  if (!requested.length) return [...INSTRUMENT_CHANNELS]
  const wanted = new Set(requested)
  const channels = INSTRUMENT_CHANNELS.filter((channel) => wanted.has(channel))
  if (!channels.length) throw new Error(`channels must name one or more of ${INSTRUMENT_CHANNELS.join(', ')}`)
  return channels
}

/**
 * The recorder. Every patch keeps the original behaviour and only observes, so the page runs
 * normally; the ring buffer bounds memory while the counters stay exact.
 */
export function instrumentScript(channels: InstrumentChannel[], capacity: number): string {
  return `(() => {
  const CH = ${JSON.stringify(channels)};
  const CAP = ${Math.max(1, capacity)};
  const on = (name) => CH.indexOf(name) !== -1;
  if (window.__closedaiInstrument) return 'already-installed';
  const state = { channels: CH, counts: {}, events: [], dropped: 0, startedAt: Date.now(), url: location.href };
  const rec = (channel, detail) => {
    state.counts[channel] = (state.counts[channel] || 0) + 1;
    if (state.events.length >= CAP) { state.events.shift(); state.dropped += 1; }
    state.events.push({ c: channel, d: String(detail == null ? '' : detail).slice(0, 200), t: Date.now() - state.startedAt });
  };
  const safe = (fn) => { try { fn(); } catch (error) { /* a locked-down page may refuse a patch */ } };

  if (on('fetch') && typeof window.fetch === 'function') safe(() => {
    const original = window.fetch;
    window.fetch = function (input, init) {
      const url = input && typeof input === 'object' && 'url' in input ? input.url : input;
      rec('fetch', ((init && init.method) || (input && input.method) || 'GET') + ' ' + url);
      return original.apply(this, arguments);
    };
  });

  if (on('xhr') && window.XMLHttpRequest) safe(() => {
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      rec('xhr', String(method) + ' ' + String(url));
      return open.apply(this, arguments);
    };
  });

  if (on('websocket') && window.WebSocket) safe(() => {
    const Original = window.WebSocket;
    const Patched = function (url, protocols) {
      rec('websocket', String(url));
      return protocols === undefined ? new Original(url) : new Original(url, protocols);
    };
    Patched.prototype = Original.prototype;
    Patched.CONNECTING = 0; Patched.OPEN = 1; Patched.CLOSING = 2; Patched.CLOSED = 3;
    window.WebSocket = Patched;
  });

  if (on('cookie')) safe(() => {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (!descriptor || !descriptor.get) return;
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get() { rec('cookie', 'read'); return descriptor.get.call(document); },
      set(value) { rec('cookie', 'write ' + String(value).split(';')[0]); descriptor.set.call(document, value); }
    });
  });

  if (on('storage') && window.Storage) safe(() => {
    const setItem = Storage.prototype.setItem;
    const getItem = Storage.prototype.getItem;
    Storage.prototype.setItem = function (key, value) {
      rec('storage', 'write ' + String(key)); return setItem.apply(this, arguments);
    };
    Storage.prototype.getItem = function (key) {
      rec('storage', 'read ' + String(key)); return getItem.apply(this, arguments);
    };
  });

  if (on('eval')) safe(() => {
    const originalEval = window.eval;
    window.eval = function (source) { rec('eval', 'eval ' + String(source)); return originalEval.apply(this, arguments); };
    const OriginalFunction = window.Function;
    const PatchedFunction = function () {
      rec('eval', 'new Function ' + Array.prototype.join.call(arguments, ','));
      return OriginalFunction.apply(this, arguments);
    };
    PatchedFunction.prototype = OriginalFunction.prototype;
    window.Function = PatchedFunction;
  });

  if (on('fingerprint')) safe(() => {
    const watchGetter = (target, property, label) => safe(() => {
      const descriptor = Object.getOwnPropertyDescriptor(target, property);
      if (!descriptor || !descriptor.get) return;
      Object.defineProperty(target, property, {
        configurable: true,
        get() { rec('fingerprint', label); return descriptor.get.call(this); }
      });
    });
    for (const property of ['userAgent', 'platform', 'languages', 'hardwareConcurrency', 'deviceMemory', 'plugins', 'webdriver']) {
      watchGetter(Navigator.prototype, property, 'navigator.' + property);
    }
    for (const property of ['width', 'height', 'colorDepth']) {
      watchGetter(Screen.prototype, property, 'screen.' + property);
    }
    safe(() => {
      const toDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function () {
        rec('fingerprint', 'canvas.toDataURL'); return toDataURL.apply(this, arguments);
      };
    });
    safe(() => {
      const getTimezoneOffset = Date.prototype.getTimezoneOffset;
      Date.prototype.getTimezoneOffset = function () {
        rec('fingerprint', 'Date.getTimezoneOffset'); return getTimezoneOffset.apply(this, arguments);
      };
    });
    safe(() => {
      if (!window.WebGLRenderingContext) return;
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (name) {
        rec('fingerprint', 'webgl.getParameter ' + String(name)); return getParameter.apply(this, arguments);
      };
    });
  });

  if (on('error')) safe(() => {
    window.addEventListener('error', (event) => rec('error', String(event.message || event.type)), true);
    window.addEventListener('unhandledrejection', (event) => rec('error', 'unhandled rejection ' + String(event.reason)), true);
  });

  window.__closedaiInstrument = state;
  return 'installed';
})()`
}

/** Read the recorder back. Returns a marker string when nothing is installed on this document. */
export const RECORDING_EXPRESSION = `(() => {
  const state = window.__closedaiInstrument;
  if (!state) return JSON.stringify({ installed: false });
  return JSON.stringify({
    installed: true, url: state.url, channels: state.channels,
    counts: state.counts, dropped: state.dropped, events: state.events
  });
})()`

export const REMOVE_EXPRESSION = `(() => {
  const installed = Boolean(window.__closedaiInstrument);
  delete window.__closedaiInstrument;
  return JSON.stringify({ removed: installed });
})()`

export type RecordedEvent = { channel: string; detail: string; atMs: number }

export type Recording = {
  installed: boolean
  url?: string
  channels?: string[]
  counts: Record<string, number>
  dropped: number
  distinct: { channel: string; detail: string; count: number }[]
  recent: RecordedEvent[]
}

/**
 * Fold the page-side buffer into the two shapes worth reading: what happened most often, and
 * what happened last. The raw event list stays in the page.
 */
export function foldRecording(raw: unknown, options: { limit: number }): Recording {
  const parsed = parseRecording(raw)
  if (!parsed || parsed.installed !== true) {
    return { installed: false, counts: {}, dropped: 0, distinct: [], recent: [] }
  }
  const events = Array.isArray(parsed.events) ? parsed.events : []
  const tally = new Map<string, { channel: string; detail: string; count: number }>()
  const recent: RecordedEvent[] = []
  for (const entry of events) {
    const event = entry !== null && typeof entry === 'object' ? entry as Record<string, unknown> : {}
    const channel = String(event.c ?? '')
    const detail = String(event.d ?? '')
    const key = channel + ' ' + detail
    const existing = tally.get(key)
    if (existing) existing.count += 1
    else tally.set(key, { channel, detail, count: 1 })
    recent.push({ channel, detail, atMs: Number(event.t) || 0 })
  }
  const counts = parsed.counts !== null && typeof parsed.counts === 'object'
    ? parsed.counts as Record<string, number>
    : {}
  return {
    installed: true,
    url: typeof parsed.url === 'string' ? parsed.url : undefined,
    channels: Array.isArray(parsed.channels) ? parsed.channels.map(String) : undefined,
    counts,
    dropped: Number(parsed.dropped) || 0,
    distinct: [...tally.values()].sort((a, b) => b.count - a.count).slice(0, options.limit),
    recent: recent.slice(-options.limit).reverse()
  }
}

function parseRecording(raw: unknown): Record<string, unknown> | null {
  const outer = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : null
  const inner = outer?.result !== null && typeof outer?.result === 'object'
    ? outer.result as Record<string, unknown>
    : null
  const text = typeof inner?.value === 'string' ? inner.value : typeof raw === 'string' ? raw : null
  if (!text) return null
  try {
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** Install on the next document and on the one already loaded, so a hook takes effect at once. */
export async function installInstrument(
  send: InstrumentSend,
  channels: InstrumentChannel[],
  capacity: number
): Promise<{ identifier: string | null; onCurrentDocument: string }> {
  const source = instrumentScript(channels, capacity)
  await send('Page.enable')
  await send('Runtime.enable')
  const added = await send('Page.addScriptToEvaluateOnNewDocument', { source })
  const record = added !== null && typeof added === 'object' ? added as Record<string, unknown> : {}
  const current = await send('Runtime.evaluate', { expression: source, returnByValue: true })
  const value = (current as { result?: { value?: unknown } } | null)?.result?.value
  return {
    identifier: typeof record.identifier === 'string' ? record.identifier : null,
    onCurrentDocument: typeof value === 'string' ? value : 'unknown'
  }
}
