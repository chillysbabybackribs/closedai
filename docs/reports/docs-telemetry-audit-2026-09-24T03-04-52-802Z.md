# Docs and tool-telemetry audit report

Generated: 2026-09-24T03:04:52.803Z

Command: `npm run audit:docs`


## 1. Metadata

- **Git HEAD:** 97365ad10fa0155d0bf45ff2cc333c21cc9844fd
- **Working tree clean:** no
- **map:check:** fail
- **Telemetry source:** /home/dp/.config/closedai/tool-telemetry.json
- **Registry tool count:** 27 tools, 82 switchable ids
- **Codex eager tool wire:** 3379 chars, 1087 advertised tokens; top eager: embedded_browser.page (2667c), closedai_app.state (712c)
- **Report path:** docs/reports/docs-telemetry-audit-2026-09-24T03-04-52-802Z.md

## 2. Stale claims in current guides

_None found._

## 3. Missing or orphan documentation

_None found._

## 4. Tool telemetry — unused and failing

- **maintainer-only** — Zero calls for tool `native_instrument.query`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=3658).

- **maintainer-only** — Zero calls for tool `native_instrument.inspect`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=3658).

- **maintainer-only** — Zero calls for tool `native_instrument.probe`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=3658).

- **maintainer-only** — Zero calls for tool `credential_vault.list`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=3658).

- **maintainer-only** — Zero calls for tool `credential_vault.read`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=3658).

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

- **user-facing** — High failure rate for `embedded_browser.script.fetch` (5 failures, 0 timeouts, 0 misuses / 11 calls)
  Review recent error notes and tool descriptions.

- **maintainer-only** — Telemetry id `embedded_browser.script.script` is not in current switchableIds (1 calls)
  Likely renamed or removed tool; counters may be stale until cleared.

- **user-facing** — High failure rate for `peer_chats.list` (10 failures, 0 timeouts, 10 misuses / 51 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — High failure rate for `tool_batch.run` (91 failures, 0 timeouts, 21 misuses / 338 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — Recent error on `closedai_app.ui.click`
  2026-09-24T02:41:02.313Z: closedai_app.ui: Control titlebar.menu-item is not rendered now (open its surface or menu first)

- **user-facing** — Recent error on `closedai_app.ui.click`
  2026-09-24T02:30:32.389Z: closedai_app.ui: Control titlebar.menu-item is not rendered now (open its surface or menu first)

- **user-facing** — Recent error on `closedai_app.ui.click`
  2026-09-24T02:26:20.122Z: closedai_app.ui: Control titlebar.menu-item is not rendered now (open its surface or menu first)

- **maintainer-only** — Recent misuse on `closedai_ui.capture`
  2026-09-24T02:22:32.446Z: closedai_ui.capture: invalid arguments — $.action is required

- **maintainer-only** — Recent misuse on `closedai_ui.capture`
  2026-09-24T02:22:28.824Z: closedai_ui.capture: invalid arguments — $.action is required

- **user-facing** — Recent error on `closedai_ui.capture.crop`
  2026-09-24T00:56:14.745Z: No retained screenshot with Capture ID frame-F2-left.png

- **user-facing** — Recent error on `peer_chats.recall`
  2026-09-24T01:25:50.136Z: peer_chats.recall: This chat has no bounded continuation source; older continuations cannot be safely recalled

- **user-facing** — Recent error on `peer_chats.recall`
  2026-09-24T00:51:41.601Z: peer_chats.recall: The saved source boundary is unavailable; refusing to read beyond it

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

- **maintainer-only** — 35 finding(s) recorded in this run
  Address stale guide lines and telemetry outliers in separate human-reviewed edits; do not auto-commit doc fixes from the auditor.
