# Docs and tool-telemetry audit report

Generated: 2026-09-25T06:01:54.521Z

Command: `npm run audit:docs`


## 1. Metadata

- **Git HEAD:** f04b532f86e0881202bbd469a5a02a04a7a6451a
- **Working tree clean:** no
- **map:check:** fail
- **Telemetry source:** /home/dp/.config/closedai/tool-telemetry.json
- **Registry tool count:** 28 tools, 86 switchable ids
- **Codex eager tool wire:** 3303 chars, 1076 advertised tokens; top eager: embedded_browser.page (2458c), closedai_app.state (845c)
- **Report path:** docs/reports/docs-telemetry-audit-2026-09-25T06-01-54-520Z.md

## 2. Stale claims in current guides

_None found._

## 3. Missing or orphan documentation

_None found._

## 4. Tool telemetry — unused and failing

- **maintainer-only** — Zero calls for tool `native_instrument.query`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=4235).

- **maintainer-only** — Zero calls for tool `native_instrument.inspect`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=4235).

- **maintainer-only** — Zero calls for tool `native_instrument.probe`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=4235).

- **maintainer-only** — Zero calls for tool `credential_vault.read`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=4235).

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

- **user-facing** — High failure rate for `peer_chats.list` (11 failures, 0 timeouts, 11 misuses / 63 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — High failure rate for `tool_batch.run` (104 failures, 0 timeouts, 22 misuses / 372 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — Recent error on `peer_chats.recall`
  2026-09-25T01:22:45.065Z: peer_chats.recall: The saved source boundary is unavailable; refusing to read beyond it

- **user-facing** — Recent error on `peer_chats.recall`
  2026-09-24T06:55:47.493Z: peer_chats.recall: This chat has no bounded continuation source; older continuations cannot be safely recalled

- **user-facing** — Recent error on `peer_chats.recall`
  2026-09-24T06:19:17.454Z: peer_chats.recall: This chat has no bounded continuation source; older continuations cannot be safely recalled

- **user-facing** — Recent error on `media.video.play`
  2026-09-25T00:54:12.897Z: media.video: play opens .mp4 or .webm files

- **user-facing** — Recent error on `media.video.render`
  2026-09-25T00:54:12.532Z: media.video: Path must stay inside the chat working directory (/home/dp/Desktop/closedai)

- **user-facing** — Recent error on `media.video.status`
  2026-09-25T00:54:11.918Z: media.video: No video job video-99; known jobs: video-1, video-2, video-3

- **maintainer-only** — Recent misuse on `search.read.wait`
  2026-09-24T23:51:56.025Z: read.wait: invalid arguments — $.max_chars is not a recognised argument

- **user-facing** — Recent error on `search.read.source`
  2026-09-24T04:32:48.801Z: search.read: Source is not ready or does not belong to this run

## 5. Research and dated docs — historical classification

- **maintainer-only** — docs/adaptive-multi-agent-development-blueprint.md treated as historical evidence
  Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.

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

- **maintainer-only** — docs/source-guided-task-execution-plan-2026-09-20.md treated as historical evidence
  Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.

- **maintainer-only** — docs/tool-harness-simulation-plan-2026-09-23.md treated as historical evidence
  Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.

- **maintainer-only** — docs/trace-research.md treated as historical evidence
  Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.

- **maintainer-only** — docs/ui-polish-backlog.md treated as historical evidence
  Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.

## 6. Recommended follow-ups (non-binding)

- **maintainer-only** — 36 finding(s) recorded in this run
  Address stale guide lines and telemetry outliers in separate human-reviewed edits; do not auto-commit doc fixes from the auditor.
