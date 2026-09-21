/** Installed once per tab via embedded_browser.script evaluate. Poll with snapshot(). */
export function installPokerAutopilotScript(heroName = 'dirtyddann'): string {
  const hero = heroName.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return `(() => {
  if (window.__closedaiPokerAutopilot) return { ok: true, already: true, snapshot: window.__closedaiPokerAutopilot.snapshot() };
  const ACTION = /^(Fold|Check|Call(?:\\s+\\$[\\d.]+)?|Raise(?:\\s+\\$[\\d.]+)?|Bet(?:\\s+\\$[\\d.]+)?|All[- ]?In)/i;
  const CARD = /^(?:[2-9TJQKA]|10)[cdhs♣♦♥♠]$/i;
  const state = {
    actions: [],
    heroTurn: false,
    heroName: null,
    holeCards: [],
    board: [],
    pot: null,
    stack: null,
    handId: null,
    wsRecent: [],
    globals: [],
    updatedAt: 0
  };
  const pushWs = (dir, data) => {
    const text = String(data == null ? '' : data).slice(0, 8000);
    state.wsRecent.push({ dir, text, t: Date.now() });
    if (state.wsRecent.length > 80) state.wsRecent.shift();
    try {
      const parsed = JSON.parse(text);
      ingest(parsed);
    } catch { /* not JSON */ }
  };
  const pickCards = (value, out, limit = 8) => {
    if (out.length >= limit || value == null) return;
    if (typeof value === 'string' && CARD.test(value.trim())) { out.push(value.trim()); return; }
    if (Array.isArray(value)) { for (const item of value) pickCards(item, out, limit); return; }
    if (typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) {
        if (/hole|pocket|hand|hero/i.test(key) && Array.isArray(nested)) pickCards(nested, out, 2);
        else if (/board|community|flop|turn|river/i.test(key)) pickCards(nested, out, 5);
        else if (/card/i.test(key)) pickCards(nested, out, limit);
      }
    }
  };
  const ingest = (node, depth = 0) => {
    if (!node || depth > 5) return;
    if (typeof node === 'object') {
      if (typeof node.pot === 'number' || typeof node.potSize === 'number') state.pot = node.pot ?? node.potSize;
      if (typeof node.handId === 'number' || typeof node.handId === 'string') state.handId = String(node.handId);
      const cards = [];
      pickCards(node, cards);
      if (cards.length === 2 && !state.holeCards.length) state.holeCards = cards.slice(0, 2);
      if (cards.length >= 3) state.board = cards.slice(0, 5);
      for (const nested of Object.values(node)) ingest(nested, depth + 1);
    }
  };
  const scanActions = () => {
    const found = [];
    for (const el of document.querySelectorAll('button, div, span, a')) {
      const label = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!label || label.length > 48 || !ACTION.test(label)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 28 || r.height < 18 || r.bottom <= 0 || r.right <= 0) continue;
      found.push({
        label,
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
        w: Math.round(r.width),
        h: Math.round(r.height)
      });
    }
    const key = (a) => a.label + '@' + a.x;
    state.actions = [...new Map(found.map((a) => [key(a), a])).values()];
    state.heroTurn = state.actions.some((a) => /^Fold/i.test(a.label));
    state.updatedAt = Date.now();
  };
  const scanText = () => {
    const body = (document.body && document.body.innerText) || '';
    const pot = body.match(/Pot:\\s*\\$?([\\d,.]+)/i);
    if (pot) state.pot = pot[1];
    const hand = body.match(/Hand:\\s*#?(\\d+)/i);
    if (hand) state.handId = hand[1];
    const hero = body.match(new RegExp('${hero}[^\\\\n]*\\\\$([\\\\d,.]+)', 'i'));
    if (hero) { state.heroName = '${hero}'; state.stack = hero[1]; }
    const tokens = body.match(/\\b([2-9TJQKA]|10)[♣♦♥♠cdhs]\\b/gi) || [];
    if (tokens.length >= 2 && !state.holeCards.length) state.holeCards = tokens.slice(0, 2);
    if (tokens.length >= 5) state.board = tokens.slice(2, 7);
  };
  const scanGlobals = () => {
    const hits = [];
    const queue = [{ obj: window, path: 'window', depth: 0 }];
    const seen = new Set();
    while (queue.length && hits.length < 12) {
      const { obj, path, depth } = queue.shift();
      if (!obj || typeof obj !== 'object' || seen.has(obj) || depth > 2) continue;
      seen.add(obj);
      for (const key of Object.keys(obj).slice(0, 40)) {
        let next;
        try { next = obj[key]; } catch { continue; }
        const p = path + '.' + key;
        if (/poker|table|game|hand|seat|player|lobby/i.test(key)) hits.push(p);
        if (next && typeof next === 'object' && depth < 2) queue.push({ obj: next, path: p, depth: depth + 1 });
      }
    }
    state.globals = hits.slice(0, 12);
  };
  try {
    const Native = WebSocket;
    window.WebSocket = function (...args) {
      const ws = new Native(...args);
      pushWs('open', String(args[0] || ''));
      ws.addEventListener('message', (ev) => pushWs('in', ev.data));
      const send = ws.send.bind(ws);
      ws.send = (data) => { pushWs('out', data); return send(data); };
      return ws;
    };
    window.WebSocket.prototype = Native.prototype;
  } catch { /* already patched or unavailable */ }
  const observer = new MutationObserver(() => { scanActions(); scanText(); });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  scanActions();
  scanText();
  scanGlobals();
  state.snapshot = () => {
    scanActions();
    scanText();
    return {
      heroTurn: state.heroTurn,
      actions: state.actions,
      heroName: state.heroName,
      holeCards: state.holeCards,
      board: state.board,
      pot: state.pot,
      stack: state.stack,
      handId: state.handId,
      wsRecent: state.wsRecent.slice(-6),
      globals: state.globals,
      updatedAt: state.updatedAt,
      url: location.href,
      title: document.title
    };
  };
  window.__closedaiPokerAutopilot = state;
  return { ok: true, installed: true, snapshot: state.snapshot() };
})()`
}

export const SNAPSHOT_POKER_AUTOPILOT = `(() => {
  const hook = window.__closedaiPokerAutopilot;
  return hook ? hook.snapshot() : { error: 'not_installed' };
})()`
