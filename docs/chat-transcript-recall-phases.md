# Chat transcript recall (phased)

ClosedAI keeps a **visible pane transcript** that can outlive a single provider thread after session rotation or Cursor Compact. Model context after rotation is intentionally thin (handoff + new thread). These phases add **tool-backed recall** so agents can recover full conversation history without injecting entire transcripts every turn.

## Tier A — handoff on send (existing)

Rotation and Compact attach deterministic digests (`closedai.chat.handoff`, thread handoff copy). Agents should treat these as orientation, not a substitute for verbatim evidence.

## Tier B — pane transcript tools (shipped)

`peer_chats.recall` and `peer_chats.spine` accept **`scope: chat`**: search the **full pane transcript**, including segments before the latest provider thread when the pane has rotated.

Behavior:

- **`scope: current`** — live provider snapshot; when the pane has `sessionRotations` and the rotation boundary item is **not** present in that snapshot, merge prerotation items from the pane’s continuation source (same rules as UI carried history).
- **`scope: chat`** — same merged item list as above; recall responses may include **`rotationEpochs`** when rotations are recorded.
- **`scope: source`** — unchanged: transcript through the frozen continuation boundary (omitted post-rotation evidence on purpose).
- **`scope: history`** — unchanged: other chats by metadata or explicit `chat_id`.

Prefer **`scope: chat`** when the user or handoff references something “earlier in this chat” after rotation or Compact. Use **`scope: source`** when you need evidence intentionally dropped from the live thread. Use literal **`peer_chats.search`** across chats for cross-pane topics; within-pane fuzzy find is Tier C.

## Tier C — lexical pane index (in progress, no embeddings)

**Product choice:** improve find-within-pane and post-rotation discovery with **tokenized lexical search** (FTS-style ranking, multi-term match, path/checkpoint facets). **No** remote embedding APIs and **no** local transformer models in the Electron app—those paths are out of scope unless explicitly revisited as opt-in experiments.

### Goals

- Help models locate **item ids** in long or rotated panes when a single literal substring is the wrong query shape.
- Keep the **read path cheap**: tool calls only query persisted index rows; they never embed or scan full transcripts synchronously.
- Preserve trust: hits are **`historical-data`** snippets; verbatim text still comes from **`peer_chats.recall(item_id=...)`**.

### Architecture (aligned with current hot index)

Reuse the same patterns as `ChatMemoryIndex` (`src/main/chat-store/chat-memory-index.ts`):

| Piece | Role |
|-------|------|
| **Background indexer** | Enqueue work on new transcript items (active pane) and on **`sessionRotations` epoch++** (all providers). Rotation may rebuild or version the pane index; handoff + checkpoint lines are indexed first so search works before full backfill completes. |
| **Per-pane lexical store** | Separate from the cross-chat hot index cap: merged **`scope: chat`** corpus (turn-shaped lines + checkpoint fields + handoff keywords). Persist under userData with char/line caps like today’s index. |
| **Search tool** | Extend **`peer_chats.search`** (or add a scoped mode) for **`scope: chat`** / caller pane only; hybrid score = term match + turn recency + role weights + optional path tokens from `changedFiles`. |
| **Fallback** | If index disabled, stale, or lagging: report status; **`recall(scope: chat, query=...)`** remains the slow literal path. |

Implementation can start with **stronger multi-token matching** on the existing line store and evolve to **SQLite FTS5** in a sidecar file per chat if substring scan becomes too slow—still no ML.

### Non-goals

- Vector / semantic similarity search.
- Injecting index hits into provider context automatically.
- Replacing Tier A handoff or Tier B recall/spine.

### Rollout slices

1. **Indexer hook** (shipped) — queue jobs after turn end / transcript remember; index merged **`scope: chat`** lines via the same turn shaping as the hot index; persist under `chat-pane-lexical-index`.
2. **`peer_chats.search` scope chat** (shipped) — caller-pane multi-term lexical hits with `itemId` + snippet + `rotationEpoch` / `indexPartial` when applicable; drill down with `recall(scope=chat|current, item_id=...)`.
3. **Checkpoint facets** (shipped) — index `goal`, list fields, and `files` from the pane checkpoint and frozen continuation checkpoint; synthetic `cp.*` item ids drill down via `recall(item_id=...)`.
4. **FTS5 (optional)** — swap scan loop for FTS when profiling says it matters; keep on-disk format versioned.

## Tier D — materialized export (optional)

User-facing export of merged pane transcript (JSON/Markdown) for audit or external tools—not required for agent recall once tier B/C exist.

## Verification

Co-located tests in `src/main/chat-context/chat-memory.test.ts` cover self-rotated panes and merged `scope: chat` reads. Tier C tests should cover rotation epoch invalidation, partial backfill, and search → recall drill-down. After changing tool contracts, update `docs/tools.md` and regenerate the session guide when cold-start orientation changes.
