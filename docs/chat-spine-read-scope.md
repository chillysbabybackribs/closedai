# Scoped slice: bounded conversation spine read (`peer_chats.spine`)

Status: **implemented** (`peer_chats.spine` v1).

## Problem

- `peer_chats.search` finds needles; `peer_chats.recall` returns **item excerpts** (800 chars, tool-heavy when `types` widens).
- On-disk index files are **flat `lines[]`** with evidence appended at the end — poor for turn-by-turn synthesis.
- Models need a **documented, bounded “conversation spine of chat X”** path aligned with handoff/index semantics.

## Recommendation (v1)

Add **`peer_chats.spine`**, not `recall(projection=…)` in v1.

| Option | Verdict |
|--------|---------|
| **`peer_chats.spine`** | **Ship v1.** Turn-shaped result, separate budget, no change to recall clients. |
| **`recall` + `projection: conversation`** | Defer or v2 alias calling the same backend if tool count is a concern. |
| Raw index file reads | Out of scope; not a trust contract. |

## Tool contract

**Name:** `peer_chats.spine`  
**Effect:** read-only, deferred like `recall`.

### Inputs

| Field | Required | Notes |
|-------|----------|--------|
| `scope` | yes | `current` \| `history` (no `source` in v1; handoff + `recall(scope=source)` stay separate). |
| `chat_id` | history only | Same rules as `recall`; omit → most recent **other** chat. |
| `limit` | no | Default **5** turns, max **8** (match recall page size). |
| `before_user_item_id` | no | Page **older** turns; cursor is the **user** message `itemId` of the oldest turn in the previous page (newest-first paging). |
| `include_evidence` | no | Default **false**. When true, up to **3** compact evidence lines **per turn** (tool/command/fileChange labels + status; no output). |
| `include_changed_files` | no | Default **true**. Chat-level `changedFiles[]` once per response (same helper as index/handoff). |

Usage errors mirror recall: `chat_id` only with `history`; caller must be the active pane thread.

### Output (`ChatSpineResult`)

```ts
{
  chatId?: string           // history
  threadId: string
  title: string | null
  cwd: string
  lastActivityAt: number
  changedFiles: string[]    // when include_changed_files
  turns: Array<{
    userItemId: string
    user: string
    assistant?: { itemId: string; text: string }   // one answer per turn (handoff rules)
    plan?: { itemId: string; text: string }
    evidence?: Array<{ itemId: string; text: string }>  // when include_evidence
  }>
  hasMore: boolean
  nextBeforeUserItemId: string | null
  trust: 'historical-data'
  provenance: 'index' | 'transcript'   // optional transparency for debugging
}
```

### Budgets

- **Serialized cap:** **16_000** characters (same family as `recall` / history list).
- **Per-turn assistant text:** full spine text until budget pressure; then trim **oldest turns** first (keep all `user` lines in page, clip or omit oldest `assistant` with `[Older answer omitted; recall item_id=…]` — reuse handoff `fitEntries` logic at turn granularity).
- **Evidence:** never includes command output, tool output, diffs, reasoning, screenshots.

### Model flow (unchanged discovery, clearer synthesis)

1. `peer_chats.search(query=…)` → pick `chatId` + `itemId`
2. `peer_chats.spine(scope=history, chat_id=…, limit=8)` → read recent turns across one chat
3. `peer_chats.recall(scope=history, chat_id=…, item_id=…, offset=…)` → evidence / long assistant body

## Shared spine builder (single source of truth)

**New export** in `src/main/chat-context/thread-handoff.ts` (or small `conversation-spine.ts` if handoff grows):

```ts
export type ConversationSpineTurn = {
  userItemId: string
  userText: string
  assistant?: { itemId: string; text: string }
  plan?: { itemId: string; text: string }
  evidence: Array<{ itemId: string; text: string }>  // compact labels
}

export function conversationSpineTurns(items: ChatTranscriptItem[]): ConversationSpineTurn[]
```

Rules (must match today’s `conversationSpineEntries` + index evidence one-liners):

- One user line per user item (context blocks stripped; attachment names appended).
- One assistant line per turn (`final_answer` wins; else last assistant message in turn).
- Attach plan items to the **current turn** by turn id / ordering.
- Attach tool/command/fileChange to the **turn they follow** (same pass as items), not a trailing global block.

**Consumers after refactor:**

| Consumer | Change |
|----------|--------|
| `thread-handoff.ts` | Build handoff prose from `conversationSpineTurns` (behavior unchanged; test locked). |
| `chat-memory-index.ts` | Serialize `lines[]` from turns (interleaved evidence); fixes evidence-at-end. |
| `memory-spine.ts` (new) | Page + budget turns for tool API. |

## Data loading (spine tool backend)

Priority per request:

1. **Hot index** — if `ChatMemoryIndex` has a record for `chatId` and index enabled: serve turns from indexed `lines` **or** rebuild turns from cached record via shared builder (prefer **re-read index file in memory** already loaded; no provider I/O). Set `provenance: 'index'`. If index stale vs store activity (`record.lastActivityAt` < chat `messageSentAt`), fall through.
2. **Live pane** — `surface.snapshot()` without display limit when thread matches.
3. **Provider transcript** — same `ChatMemory.read` / `readThread` path as `recall(scope=history)` (including Cursor queue behavior).

Index miss (chat #11+ LRU): still works via transcript load; search + spine + recall remains coherent.

**Do not** expose reading `userData/chat-memory-index/` paths to the model shell.

## Code touch points

### Shared

- `src/shared/chat-memory.ts` — `ChatSpineRequest`, `ChatSpineResult`, `ChatSpineTurn` types (or `chat-spine.ts` if kept separate from recall types).

### Main

- `src/main/chat-context/thread-handoff.ts` — `conversationSpineTurns`; refactor handoff to use it.
- `src/main/chat-context/memory-spine.ts` (+ `memory-spine.test.ts`) — `spineTranscript(items, request)` paging + 16k budget.
- `src/main/chat-context/chat-memory.ts` — `async spine(caller, request)` mirroring recall scope/load rules.
- `src/main/chat-store/chat-memory-index.ts` — build index lines from turns (follow-up in same PR or immediately after).
- `src/main/chat-peers/peer-manager.ts` — pass index into memory if not already on `ChatMemory` constructor (inject `ChatMemoryIndex | null`).
- `src/main/tools/peer-chats/memory-tools.ts` — register `spine` tool next to `recall`.
- `src/main/tools/peer-chats/index.ts` — namespace blurb: search → spine → recall.
- `src/main/tools/catalog.ts` + `scripts/tool-slices.json` — Read-only preset includes `peer_chats.spine`.

### Docs / guide

- `docs/tools.md` — new subsection under Working memory; table row for `spine`.
- `docs/application.md` — one sentence: spine read is derived; provider store authoritative.
- `scripts/agent-guide-outline.json` — “cross-chat: search; one-chat synthesis: spine; evidence: recall.”
- `npm run guide:generate`

### Tests

- `thread-handoff.test.ts` — turn grouping, final_answer, evidence attached to turn.
- `memory-spine.test.ts` — paging cursor, 16k cap, include_evidence cap per turn.
- `chat-memory.test.ts` — history + current spine; rejects bad scope/chat_id.
- `peer-chats.test.ts` — tool registered; disabled memory.
- `chat-memory-index.test.ts` — evidence not only at EOF (if index refactor in slice).

## Implementation order

1. **`conversationSpineTurns` + handoff refactor** (tests prove no handoff drift).
2. **`memory-spine` + `ChatMemory.spine`** (transcript path only).
3. **`peer_chats.spine` + catalog/docs/guide**.
4. **Index serialization via turns** (fixes on-disk shape; optional index fast path in spine loader).
5. **(Optional v1.1)** Index fast path + `provenance` field.

## Explicitly out of scope

- Semantic / embedding search.
- `scope: source` for spine.
- Full assistant bodies without recall paging.
- User-facing settings beyond existing index toggles.
- Warm tier / persisted NDJSON layout (index file shape can improve without new tools).

## Acceptance criteria

- Model can fetch **≤8 turns** of handoff-equivalent prose for a history chat in **one call** under 16k chars.
- Evidence default off; turning it on stays compact and per-turn.
- Handoff text for continued chats **byte-stable** within existing test tolerances.
- Index files interleave evidence with turns (no 100-line tool tail).
- Docs state: index may lag one turn; transcript path used when index missing or stale.
