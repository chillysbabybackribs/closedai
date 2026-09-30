# Docs and tool-telemetry audit report

Generated: 2026-09-30T06:58:34.314Z

Command: `npm run audit:docs`


## 1. Metadata

- **Git HEAD:** 3a2ef1fda68b636f787fbfb9413a60583b8241f8
- **Working tree clean:** yes
- **map:check:** fail
- **Telemetry source:** /home/dp/.config/closedai/tool-telemetry.json
- **Registry tool count:** 35 tools, 94 switchable ids
- **Codex eager tool wire:** 3596 chars, 1202 advertised tokens; top eager: embedded_browser.page (2428c), closedai_app.state (1168c)
- **Report path:** docs/reports/docs-telemetry-audit-2026-09-30T06-58-34-313Z.md

## 2. Stale claims in current guides

_None found._

## 3. Missing or orphan documentation

_None found._

## 4. Tool telemetry — unused and failing

- **maintainer-only** — Zero calls for tool `native_instrument.query`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=5695).

- **maintainer-only** — Zero calls for tool `native_instrument.inspect`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=5695).

- **maintainer-only** — Zero calls for tool `native_instrument.probe`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=5695).

- **maintainer-only** — Zero calls for tool `credential_vault.read`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=5695).

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

- **user-facing** — High failure rate for `peer_chats.read` (36 failures, 0 timeouts, 36 misuses / 234 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — High failure rate for `tool_batch.run` (109 failures, 0 timeouts, 23 misuses / 397 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — Recent error on `peer_chats.recall`
  2026-09-30T06:21:14.571Z: peer_chats.recall: No matching conversation is available in history

- **user-facing** — Recent error on `peer_chats.recall`
  2026-09-30T06:19:25.209Z: peer_chats.recall: No matching conversation is available in history

- **user-facing** — Recent error on `peer_chats.recall`
  2026-09-30T06:18:47.027Z: peer_chats.recall: No matching conversation is available in history

- **user-facing** — Recent error on `peer_chats.spine`
  2026-09-30T06:21:11.463Z: peer_chats.spine: No matching conversation is available in history

- **user-facing** — Recent error on `peer_chats.spine`
  2026-09-30T06:19:23.275Z: peer_chats.spine: No matching conversation is available in history

- **user-facing** — Recent error on `peer_chats.spine`
  2026-09-30T04:40:00.969Z: peer_chats.spine: No matching conversation is available in history

- **user-facing** — Recent error on `closedai_app.ui.click`
  2026-09-30T05:37:41.541Z: closedai_app.ui: real pointer or keyboard input must run inside tool_batch.run (or one Codex exec script)

- **user-facing** — Recent timeout on `closedai_app.ui.wait_for`
  2026-09-30T04:49:38.201Z: {

## 5. Research and dated docs — historical classification

- **maintainer-only** — docs/adaptive-multi-agent-development-blueprint.md treated as historical evidence
  Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.

- **maintainer-only** — docs/chat-spine-read-scope.md treated as review manually
  Not in the current-guides table; confirm README classification.

- **maintainer-only** — docs/chat-transcript-recall-phases.md treated as review manually
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

## 6. Recommended follow-ups (non-binding)

- **maintainer-only** — 38 finding(s) recorded in this run
  Address stale guide lines and telemetry outliers in separate human-reviewed edits; do not auto-commit doc fixes from the auditor.
