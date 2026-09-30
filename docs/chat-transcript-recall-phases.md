# Chat transcript recall (phased)

ClosedAI keeps a **visible pane transcript** that can outlive a single provider thread after session rotation or Cursor Compact. Model context after rotation is intentionally thin (handoff + new thread). These phases add **tool-backed recall** so agents can recover full conversation history without injecting entire transcripts every turn.

## Tier A — handoff on send (existing)

Rotation and Compact attach deterministic digests (`closedai.chat.handoff`, thread handoff copy). Agents should treat these as orientation, not a substitute for verbatim evidence.

## Tier B — pane transcript tools (phase 1, current)

`peer_chats.recall` and `peer_chats.spine` accept **`scope: chat`**: search the **full pane transcript**, including segments before the latest provider thread when the pane has rotated.

Behavior:

- **`scope: current`** — live provider snapshot; when the pane has `sessionRotations` and the rotation boundary item is **not** present in that snapshot, merge prerotation items from the pane’s continuation source (same rules as UI carried history).
- **`scope: chat`** — same merged item list as above; recall responses may include **`rotationEpochs`** when rotations are recorded.
- **`scope: source`** — unchanged: transcript through the frozen continuation boundary (omitted post-rotation evidence on purpose).
- **`scope: history`** — unchanged: other chats by metadata or explicit `chat_id`.

Prefer **`scope: chat`** when the user or handoff references something “earlier in this chat” after rotation or Compact. Use **`scope: source`** when you need evidence intentionally dropped from the live thread. Use literal **`peer_chats.search`** across chats for cross-pane topics; semantic recall is phase 2.

## Tier C — semantic index (planned)

Per-`chat_id` embedding index over transcript items and checkpoints, hybrid-ranked with literal `item_id` drill-down via `recall`. Rebuild on rotation boundaries; optional background indexing for long panes.

## Tier D — materialized export (optional)

User-facing export of merged pane transcript (JSON/Markdown) for audit or external tools—not required for agent recall once tier B/C exist.

## Verification

Co-located tests in `src/main/chat-context/chat-memory.test.ts` cover self-rotated panes and merged `scope: chat` reads. After changing tool contracts, update `docs/tools.md` and regenerate the session guide when cold-start orientation changes.
