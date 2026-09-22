# Docs and tool-telemetry audit report

Generated: 2026-09-22T09:17:48.349Z

Command: `npm run audit:docs`

Spec: [docs-telemetry-auditor-spec.md](../agent-workspace/docs-telemetry-auditor-spec.md)

## 1. Metadata

- **Git HEAD:** b911b1e8eb84e28d6af798d3b76c676caa6af279
- **Working tree clean:** no
- **map:check:** pass
- **Telemetry source:** /home/dp/.config/closedai/tool-telemetry.json
- **Registry tool count:** 28 tools, 81 switchable ids
- **Report path:** docs/reports/docs-telemetry-audit-2026-09-22T09-17-48-349Z.md

## 2. Stale claims in current guides

_None found._

## 3. Missing or orphan documentation

_None found._

## 4. Tool telemetry — unused and failing

- **maintainer-only** — Zero calls for tool `native_instrument.query`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=921).

- **maintainer-only** — Zero calls for tool `native_instrument.inspect`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=921).

- **maintainer-only** — Zero calls for tool `native_instrument.probe`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=921).

- **maintainer-only** — Zero calls for tool `credential_vault.list`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=921).

- **maintainer-only** — Zero calls for tool `credential_vault.read`
  No tool-level or action-level calls since 2026-09-22T00:46:29.752Z (totalCalls=921).

- **user-facing** — High failure rate for `closedai_app.command.new_chat` (1 failures, 0 timeouts, 1 misuses / 8 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — High failure rate for `closedai_app.command.send_message` (3 failures, 0 timeouts, 0 misuses / 8 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — High failure rate for `closedai_app.ui.press_key` (2 failures, 0 timeouts, 1 misuses / 12 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — High failure rate for `closedai_app.ui.wait_for` (1 failures, 7 timeouts, 1 misuses / 34 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — High failure rate for `closedai_ui.capture.crop` (2 failures, 0 timeouts, 0 misuses / 7 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — High failure rate for `embedded_browser.script.fetch` (3 failures, 0 timeouts, 0 misuses / 7 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — High failure rate for `peer_chats.list` (7 failures, 0 timeouts, 7 misuses / 25 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — High failure rate for `tool_batch.run` (19 failures, 0 timeouts, 4 misuses / 58 calls)
  Review recent error notes and tool descriptions.

- **user-facing** — Recent error on `closedai_app.command.send_message`
  2026-09-22T09:09:07.034Z: closedai_app.command: Pane 96b32952-04cf-4443-8e76-3816ecfaa67c is already running a turn; stop it or wait for state.chat.running to clear

- **maintainer-only** — Recent misuse on `closedai_app.command.new_chat`
  2026-09-22T09:09:03.624Z: command.new_chat: invalid arguments — $.title is not a recognised argument

- **user-facing** — Recent error on `closedai_app.command.stop_agent`
  2026-09-22T09:08:59.030Z: closedai_app.command: Unknown chat pane: acc11f2f-b2f8-43f8-a4ae-0e5a9f1e76b5

- **user-facing** — Recent error on `tool_batch.run`
  2026-09-22T09:01:19.972Z: 0 of 7 calls succeeded (6 skipped). Failed: [1] ui — ui: Element is covered at its clickable center by .fixed

- **user-facing** — Recent error on `tool_batch.run`
  2026-09-22T09:01:02.673Z: 4 of 5 calls succeeded. Failed: [5] ui — ui.controls: invalid arguments — $.control is not a recognised argument

- **maintainer-only** — Recent misuse on `tool_batch.run`
  2026-09-22T07:09:59.481Z: tool_batch.run: real-input fallback call [1] needs a later read or wait action that verifies its result

- **user-facing** — Recent error on `closedai_app.ui.click`
  2026-09-22T09:01:19.972Z: ui: Element is covered at its clickable center by .fixed

- **user-facing** — Recent error on `closedai_app.ui.click`
  2026-09-22T09:01:10.629Z: closedai_app.ui: real pointer or keyboard input must run inside tool_batch.run (or one Codex exec script)

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

- **maintainer-only** — docs/trace-research.md treated as historical evidence
  Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.

- **maintainer-only** — docs/ui-polish-backlog.md treated as historical evidence
  Listed in docs/README.md dated table or filename pattern; not authoritative over current guides.

## 6. Recommended follow-ups (non-binding)

- **maintainer-only** — 31 finding(s) recorded in this run
  Address stale guide lines and telemetry outliers in separate human-reviewed edits; do not auto-commit doc fixes from the auditor.
