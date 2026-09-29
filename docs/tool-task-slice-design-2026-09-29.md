# Task-scoped tool slices (design)

Status: **Phase 1 (Codex) landed** — slice manifest + `applyToolSlice()`, Codex `thread/start` catalog via `resolveCodexToolCatalog()` when `chatToolSliceEnabled` is true. Cursor/Claude adapters remain Phase 2–3.

## Problem

Provider discovery (`deferLoading`, Claude ToolSearch, etc.) saves context but adds latency and missed routing. Loading **all** tool schemas (Cursor today) preserves salience but costs tens of thousands of characters. Description trimming helps at the margin; it does not change the shape of the tradeoff.

We need **task-scoped full schemas for the tools that matter now**, with discovery as **fallback** for the long tail.

## Non-goals

- Replacing provider-native file/repo tools (Cursor, Codex, Claude keep their own loops).
- Letting the model invent arbitrary tools without registry validation (experimental track only, off by default).
- Bypassing Tools modal switches or credential approval.

## Provider constraints (hard)

| Lane | Inject / swap catalog | Notes |
|------|------------------------|--------|
| **Codex** | `dynamicTools` on `thread/start` only | Resume restores saved catalog; change ⇒ **new thread + handoff** (`ensureCodexThread`). |
| **Claude** | MCP list at process start | New process on idle close; `alwaysLoad` per tool. ToolSearch for deferred. |
| **Antigravity** | Global MCP config + eager subset | Same defer story as Codex for non-eager. |
| **Cursor** | `mcpServers` on `session/new` / load | Per-namespace HTTP endpoints; can **omit namespaces** to shrink surface. No `deferLoading` flag. |

**Implication:** A task slice is a **catalog view** (eager set + optional namespace subset), not a per-turn JSON blob in user text. Applying a new slice on Codex is a **rotation event**, same as tool-switch refresh today.

## Proposed system: **Tool Task Slice (TTS)**

### 1. Slice manifest (versioned, CI-checked)

`scripts/tool-slices.json` defines named slices:

- **`resetEager: true`** — defer every tool, then **greedy-promote** from `promotePriority` until `codexEagerWireCap` (3600 today). This **replaces** the default pair (`embedded_browser.page`, `closedai_app.state`) when the task is not browser-first.
- **`resetEager: false`** — keep registry defaults (`full` / discovery fallback).

`validateToolSliceCatalog()` proves ids exist and eager wire ≤ cap.

### 2. Slice selection (hardened, layered)

Order of authority:

1. **User** — Tools modal groups / future “task profile” preset (cannot enable disabled trust groups).
2. **Deterministic signals** — e.g. browser subject fragment ⇒ `browser`; research heuristic ⇒ `research`; else `core` (see manifest `signals`; rules engine TBD).
3. **Explicit model call** — optional `tool_slice.apply` meta-tool (Phase 2) with allowlisted slice ids only.
4. **Fallback** — `full` slice + provider discovery.

No slice may promote tools the user disabled.

### 3. Adapter behavior (Phase 1–3)

**Phase 1 — Codex**

- Before `thread/start`, run `applyToolSliceById(registry, catalog, sliceId)`.
- Pass **`dynamicToolSpecs(sliced.registry)`** instead of full registry.
- When slice changes mid-chat, reuse existing **catalog mismatch ⇒ rotate** path.
- Attach slice id + promoted ids to turn trace / telemetry.

**Phase 2 — Cursor**

- Map slice ⇒ **namespace allowlist** (e.g. `core` ⇒ `closedai_app`, `search`, `peer_chats`, `tool_batch`; omit `browser_cdp`, `native_instrument` unless slice says so).
- `CursorToolBridge.servers(key, { namespaces })` filters endpoints.
- Session reload when slice changes (ACP has no hot-swap catalog standard).

**Phase 3 — Claude / Antigravity**

- Claude: map promoted ids ⇒ `alwaysLoad: true` on those MCP tools only; rest deferred + ToolSearch.
- Antigravity: eager declarations = promoted set only.

### 4. Discovery stays fallback

All user-enabled tools remain **callable** after discovery / ToolSearch / loading deferred stubs. Slice only changes **what is fully expanded without a discovery step**.

## Hardening checklist

- [x] Versioned JSON manifest + parse tests
- [x] Greedy promotion under wire cap
- [x] `resetEager` swaps default browser eager off on workspace tasks
- [x] Wire slice selection into `ensureCodexThread` / turn build (`chatToolSliceEnabled`)
- [x] Telemetry: trace `codex.tool_slice` with slice id and promoted ids
- [ ] Guide outline: one line on slice + discovery fallback
- [ ] Cursor namespace filter + session reload tests
- [ ] Property: promoted ⊆ enabled switchable ids

## Experimental track: hyper-reduced “template” tools (lab only)

Separate **experimental** lane (Settings flag; never default):

| Idea | Role | Risk |
|------|------|------|
| **`tool.invoke` stub** | Single tool: `{ name, arguments: object }` validated at runtime against registry | Model sends wrong shapes; must keep strict `usageResult` |
| **Regex / slot fill** | Host fills args from user text for fixed patterns | Brittle; locale-sensitive |
| **Model-generated micro-schema** | Host validates generated JSON Schema against allowlist | Supply-chain / injection |
| **Template library** | Pre-approved `{ tool, argTemplate }` cards in slice manifest | Maintenance |

These do **not** replace TTS; they are a research fork for “Composer speed with Codex wire limits.” If pursued, run only in isolated chats with full trace and no secret-bearing tools unless explicitly armed.

## Relation to Composer parity

Composer parity = **outcome** (right tool first try), not identical transport. TTS + namespace filtering moves Codex/Cursor toward Composer salience **without** loading 65k+ chars on every turn. Cursor remains the reference; sliced Cursor (namespace tiers) should match slice ids used on Codex for consistent behavior across lanes.

## Next implementation step

Wire **slice selection stub** (`core` | `browser` | `research` from turn signals) into Codex `startThreadParams` behind a Settings flag (`chatToolSliceEnabled`), log promoted ids, and verify rotation when slice changes between sends.
