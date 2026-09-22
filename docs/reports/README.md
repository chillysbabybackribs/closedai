# Docs and tool-telemetry audit reports

Timestamped markdown reports from the report-only auditor (no automatic doc edits).

**Run:** `npm run audit:docs`

Optional telemetry path (defaults to `~/.config/closedai/tool-telemetry.json`):

```sh
npm run audit:docs -- --telemetry=/path/to/tool-telemetry.json
```

Each run writes `docs-telemetry-audit-<ISO-timestamp>.md` in this directory.
