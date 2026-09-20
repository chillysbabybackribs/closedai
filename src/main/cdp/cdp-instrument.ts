// What a page does before an agent can look at it is normally unobservable: by the time any
// tool evaluates script, the site has already read cookies, fingerprinted the device, and made
// its first requests. `Page.addScriptToEvaluateOnNewDocument` runs ahead of the page's own code
// and survives navigation, so the recorder below wraps the APIs that matter and answers "what
// did this site actually do, from its first instruction" — with the counting done in the page
// and only a bounded fold shipped back.

export type InstrumentSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>

export const INSTRUMENT_CHANNELS = [
  'fetch', 'xhr', 'websocket', 'cookie', 'storage', 'fingerprint', 'error'
] as const

export type InstrumentChannel = typeof INSTRUMENT_CHANNELS[number]

export const DEFAULT_CAPACITY = 500

export function channelsFrom(requested: string[]): InstrumentChannel[] {
  if (!requested.length) return [...INSTRUMENT_CHANNELS]
  const wanted = new Set(requested)
  const channels = INSTRUMENT_CHANNELS.filter((channel) => wanted.has(channel))
  if (!channels.length || requested.some((name) => !INSTRUMENT_CHANNELS.includes(name as InstrumentChannel))) {
    throw new Error(`channels must name one or more of ${INSTRUMENT_CHANNELS.join(', ')}`)
  }
  return channels
}

/**
 * Best-effort main-world instrumentation. Wrappers are observable to the page; eval is never
 * patched because wrapping it changes lexical scope. Cleanup disables even retained wrappers.
 */
export function instrumentScript(channels: InstrumentChannel[], capacity: number): string {
  return `(() => {
  const CH = ${JSON.stringify(channels)};
  const CAP = ${Math.max(1, capacity)};
  const on = (name) => CH.indexOf(name) !== -1;
  if (window.__closedaiInstrument) window.__closedaiInstrument.stop();
  const state = { channels: CH, patches: [], counts: {}, events: [], dropped: 0, startedAt: Date.now(), url: location.href };
  const cleanup = [];
  let active = true;
  const rec = (channel, detail) => {
    if (!active) return;
    state.counts[channel] = (state.counts[channel] || 0) + 1;
    if (state.events.length >= CAP) { state.events.shift(); state.dropped += 1; }
    state.events.push({ c: channel, d: String(detail == null ? '' : detail).slice(0, 200), t: Date.now() - state.startedAt });
  };
  const failure = (channel, feature, error) => state.patches.push({ channel, feature, installed: false, reason: String(error) });
  const same = (a, b) => Boolean(a && b && a.value === b.value && a.get === b.get && a.set === b.set &&
    a.writable === b.writable && a.configurable === b.configurable && a.enumerable === b.enumerable);
  const patch = (channel, target, key, make) => {
    try {
      if (!target) throw new Error('API unavailable');
      const before = Object.getOwnPropertyDescriptor(target, key);
      const descriptor = make(before);
      Object.defineProperty(target, key, descriptor);
      const installed = Object.getOwnPropertyDescriptor(target, key);
      const report = { channel, feature: key, installed: true };
      state.patches.push(report);
      cleanup.push(() => {
        if (!same(Object.getOwnPropertyDescriptor(target, key), installed)) return { feature: key, restored: false, reason: 'changed-by-page' };
        if (before) Object.defineProperty(target, key, before);
        else delete target[key];
        return { feature: key, restored: true };
      });
    } catch (error) { failure(channel, key, error); }
  };
  const method = (channel, target, key, wrap) => patch(channel, target, key, (descriptor) => {
    if (!descriptor || typeof descriptor.value !== 'function') throw new Error('Method unavailable');
    return { ...descriptor, value: wrap(descriptor.value) };
  });
  state.stop = () => {
    active = false;
    const restored = [];
    for (const undo of cleanup.splice(0).reverse()) {
      try { restored.push(undo()); } catch (error) { restored.push({ restored: false, reason: String(error) }); }
    }
    return restored;
  };

  if (on('fetch')) method('fetch', window, 'fetch', (original) => function (input, init) {
    const url = input && typeof input === 'object' && 'url' in input ? input.url : input;
    rec('fetch', ((init && init.method) || (input && input.method) || 'GET') + ' ' + url);
    return original.apply(this, arguments);
  });

  if (on('xhr')) method('xhr', window.XMLHttpRequest && XMLHttpRequest.prototype, 'open', (open) => function (verb, url) {
    rec('xhr', String(verb) + ' ' + String(url));
    return open.apply(this, arguments);
  });

  if (on('websocket')) method('websocket', window, 'WebSocket', (Original) => new Proxy(Original, {
    construct(target, args, newTarget) {
      rec('websocket', String(args[0]));
      return Reflect.construct(target, args, newTarget);
    }
  }));

  if (on('cookie')) patch('cookie', document, 'cookie', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (!descriptor || !descriptor.get) throw new Error('Cookie accessor unavailable');
    return {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() { rec('cookie', 'read'); return descriptor.get.call(this); },
      set(value) { rec('cookie', 'write'); return descriptor.set.call(this, value); }
    };
  });

  if (on('storage')) {
    const target = window.Storage && Storage.prototype;
    method('storage', target, 'setItem', (setItem) => function (key, value) {
      rec('storage', 'write ' + String(key)); return setItem.apply(this, arguments);
    });
    method('storage', target, 'getItem', (getItem) => function (key) {
      rec('storage', 'read ' + String(key)); return getItem.apply(this, arguments);
    });
  }

  if (on('fingerprint')) {
    const watchGetter = (target, property, label) => patch('fingerprint', target, property, (descriptor) => {
      if (!descriptor || !descriptor.get) throw new Error('Getter unavailable');
      return {
        ...descriptor,
        get() { rec('fingerprint', label); return descriptor.get.call(this); }
      };
    });
    for (const property of ['userAgent', 'platform', 'languages', 'hardwareConcurrency', 'deviceMemory', 'plugins', 'webdriver']) {
      watchGetter(window.Navigator && Navigator.prototype, property, 'navigator.' + property);
    }
    for (const property of ['width', 'height', 'colorDepth']) {
      watchGetter(window.Screen && Screen.prototype, property, 'screen.' + property);
    }
    method('fingerprint', window.HTMLCanvasElement && HTMLCanvasElement.prototype, 'toDataURL', (toDataURL) => function () {
      rec('fingerprint', 'canvas.toDataURL'); return toDataURL.apply(this, arguments);
    });
    method('fingerprint', Date.prototype, 'getTimezoneOffset', (getTimezoneOffset) => function () {
      rec('fingerprint', 'Date.getTimezoneOffset'); return getTimezoneOffset.apply(this, arguments);
    });
    method('fingerprint', window.WebGLRenderingContext && WebGLRenderingContext.prototype, 'getParameter', (getParameter) => function (name) {
      rec('fingerprint', 'webgl.getParameter ' + String(name)); return getParameter.apply(this, arguments);
    });
  }

  if (on('error')) {
    for (const type of ['error', 'unhandledrejection']) {
      const listener = (event) => rec('error', String(event.message || event.reason || event.type));
      try {
        window.addEventListener(type, listener, true);
        state.patches.push({ channel: 'error', feature: type, installed: true });
        cleanup.push(() => { window.removeEventListener(type, listener, true); return { feature: type, restored: true }; });
      } catch (error) { failure('error', type, error); }
    }
  }

  window.__closedaiInstrument = state;
  return 'installed';
})()`
}

/** Read the recorder back. Returns a marker string when nothing is installed on this document. */
export const RECORDING_EXPRESSION = `(() => {
  const state = window.__closedaiInstrument;
  if (!state) return JSON.stringify({ installed: false });
  return JSON.stringify({
    installed: true, url: state.url, channels: state.channels, patches: state.patches,
    counts: state.counts, dropped: state.dropped, events: state.events
  });
})()`

export const REMOVE_EXPRESSION = `(() => {
  const state = window.__closedaiInstrument;
  const restored = state ? state.stop() : [];
  delete window.__closedaiInstrument;
  return JSON.stringify({ removed: Boolean(state), restored });
})()`

export type RecordedEvent = { channel: string; detail: string; atMs: number }

export type Recording = {
  installed: boolean
  url?: string
  channels?: string[]
  patches?: Array<{ channel: string; feature: string; installed: boolean; reason?: string }>
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
    const key = JSON.stringify([channel, detail])
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
    patches: Array.isArray(parsed.patches) ? parsed.patches as NonNullable<Recording['patches']> : [],
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
  const identifier = typeof record.identifier === 'string' ? record.identifier : null
  try {
    const current = await send('Runtime.evaluate', { expression: source, returnByValue: true })
    const evaluated = current as { result?: { value?: unknown }; exceptionDetails?: unknown } | null
    if (evaluated?.exceptionDetails) throw new Error('Recorder installation failed in the document; reload before retrying')
    const value = evaluated?.result?.value
    return { identifier, onCurrentDocument: typeof value === 'string' ? value : 'unknown' }
  } catch (error) {
    if (identifier) {
      try { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier }) }
      catch { throw new Error('Recorder installation and future-script cleanup failed; close the tab before retrying', { cause: error }) }
    }
    throw error
  }
}
