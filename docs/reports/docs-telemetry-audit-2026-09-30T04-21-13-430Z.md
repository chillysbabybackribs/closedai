# Docs and tool-telemetry audit report

Generated: 2026-09-30T04:21:13.430Z

Command: `npm run audit:docs`


## 1. Metadata

- **Git HEAD:** 0fb65190fa5c01a17ea56c213ead9bcf41f18525
- **Working tree clean:** no
- **map:check:** fail
- **Telemetry source:** /home/dp/.config/closedai/tool-telemetry.json
- **Registry tool count:** 35 tools, 94 switchable ids
- **Codex eager tool wire:** 3456 chars, 1167 advertised tokens; top eager: embedded_browser.page (2428c), closedai_app.state (1028c)
- **Report path:** docs/reports/docs-telemetry-audit-2026-09-30T04-21-13-430Z.md

## 2. Stale claims in current guides

_None found._

## 3. Missing or orphan documentation

_None found._

## 4. Tool telemetry — unused and failing

- **maintainer-only** — Zero calls for tool `native_instrument.query`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=5468).

- **maintainer-only** — Zero calls for tool `native_instrument.inspect`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=5468).

- **maintainer-only** — Zero calls for tool `native_instrument.probe`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=5468).

- **maintainer-only** — Zero calls for tool `credential_vault.read`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=5468).

- **user-facing** — High failure rate for `closedai_app.agent` (2 failures, 0 timeouts, 1 misuses / 5 calls)
  Review recent error notes and tool descriptions.

- **maintainer-only** — Telemetry id `closedai_app.state.wait_for` is not in current switchableIds (1 calls)
  Likely renamed or removed tool; counters may be stale until cleared.

- **maintainer-only** — Telemetry id `closedai_project.mutate` is not in current switchableIds (9 calls)
  Likely renamed or removed tool; counters may be stale until cleared.

- **maintainer-only** — Telemetry id `closedai_project.snapshot` is not in current switchableIds (5 calls)
  Likely renamed or removed tool; counters may be stale until cleared.

- **maintainer-only** — Telemetry id `closedai_ui.capture.agent_workspace` is not in current switchableIds (7 calls)
  Likely renamed or removed tool; counters may be stale until cleared.

- **maintainer-only** — Telemetry id `closedai_ui.capture.screenshot` is not in current switchableIds (2 calls)
  Likely renamed or removed tool; counters may be stale until cleared.

- **maintainer-only** — Telemetry id `embedded_browser.page.page` is not in current switchableIds (1 calls)
  Likely renamed or removed tool; counters may be stale until cleared.

- **user-facing** — High failure rate for `embedded_browser.script.extract` (4 failures, 0 timeouts, 3 misuses / 7 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — High failure rate for `embedded_browser.script.fetch` (5 failures, 0 timeouts, 0 misuses / 14 calls)
  Review recent error notes and tool descriptions.

- **maintainer-only** — Telemetry id `embedded_browser.script.script` is not in current switchableIds (1 calls)
  Likely renamed or removed tool; counters may be stale until cleared.

- **user-facing** — High failure rate for `media.video` (7 failures, 0 timeouts, 0 misuses / 13 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — High failure rate for `media.video.render` (5 failures, 0 timeouts, 0 misuses / 8 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — High failure rate for `peer_chats.list` (14 failures, 0 timeouts, 14 misuses / 112 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — High failure rate for `peer_chats.read` (35 failures, 0 timeouts, 35 misuses / 227 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — High failure rate for `tool_batch.run` (107 failures, 0 timeouts, 22 misuses / 391 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — Recent error on `peer_chats.recall`
  2026-09-30T04:12:29.675Z: peer_chats.recall: No matching conversation is available in history

- **user-facing** — Recent error on `peer_chats.recall`
  2026-09-30T04:10:42.645Z: peer_chats.recall: No matching conversation is available in history

- **user-facing** — Recent error on `peer_chats.recall`
  2026-09-30T04:10:36.079Z: peer_chats.recall: No matching conversation is available in history

- **user-facing** — Recent error on `peer_chats.spine`
  2026-09-30T04:12:23.955Z: peer_chats.spine: No matching conversation is available in history

- **maintainer-only** — Recent misuse on `peer_chats.read`
  2026-09-30T04:03:00.693Z: Unknown peer chat "1d0eb1bd-8b09-4a63-855f-519293ec64c8". Use list for open peers (paneId is chat_id), or list(scope=history) and recall(scope=history) for closed chats.

- **maintainer-only** — Recent misuse on `peer_chats.read`
  2026-09-30T03:28:09.720Z: Unknown peer chat "b1266276-830c-4d7f-b5be-26eed600cf4c". Use list for open peers (paneId is chat_id), or list(scope=history) and recall(scope=history) for closed chats.

- **maintainer-only** — Recent misuse on `peer_chats.read`
  2026-09-30T03:15:06.945Z: Unknown peer chat "7dc2cf6a-8b0e-4c0e-9f2a-8e3b4c5d6e7f". Use list for open peers (paneId is chat_id), or list(scope=history) and recall(scope=history) for closed chats.

- **user-facing** — Recent error on `closedai_ui.capture.crop`
  2026-09-30T03:39:25.408Z: Crop (0, 0, 900x800) exceeds source image 851x720

## 5. Research and dated docs — historical classification

- **maintainer-only** — docs/adaptive-multi-agent-development-blueprint.md treated as historical evidence
  Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.

- **maintainer-only** — docs/chat-spine-read-scope.md treated as review manually
  Not in the current-guides table; confirm README classification.

- **maintainer-only** — docs/codex-desktop-recon.md treated as historical evidence
  Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.

- **maintainer-only** — docs/electron-browser-platform-review.md treated as review manually
  Not in the current-guides table; confirm README classification.

- **maintainer-only** — docs/frida-capability-assessment-2026-09-20.md treated as historical evidence
  Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.

- **maintainer-only** — docs/model-harness-audit-2026-09-04.md treated as historical evidence
  Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.

- **maintainer-only** — docs/model-latency-audit-2026-09-04.md treated as historical evidence
  Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.

- **maintainer-only** — docs/parallel-web-research-2026-09-04.md treated as historical evidence
  Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.

- **maintainer-only** — docs/reddit-multi-provider-landscape-2026-09-29.md treated as historical evidence
  Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.

- **maintainer-only** — docs/source-guided-task-execution-plan-2026-09-20.md treated as historical evidence
  Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.

- **maintainer-only** — docs/tool-harness-simulation-plan-2026-09-23.md treated as historical evidence
  Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.

- **maintainer-only** — docs/tool-task-slice-design-2026-09-29.md treated as historical evidence
  Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.

## 6. Recommended follow-ups (non-binding)

- **maintainer-only** — 39 finding(s) recorded in this run
  Address stale guide lines and telemetry outliers in separate human-reviewed edits; do not auto-commit doc fixes from the auditor.
