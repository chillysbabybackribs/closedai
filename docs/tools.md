# Tools

Everything the app offers a model lives under `src/main/tools/`. Tools are provider-agnostic:
the registry is the single source of truth, and a provider adapter (Codex today via
`app-server-tools.ts`; others later) translates it to that provider's protocol.

## Three levels, three rules

Decide where a capability goes before writing it. Pick the lowest level that fits.

| Level | What it is | Add a new one only when |
|---|---|---|
| **Namespace** | A domain, e.g. `search`, `browser`. One directory. | The domain differs. |
| **Verb tool** | One tool to the model. Groups actions that share a result shape and a trust level. One `index.ts` per tool built with `defineActionTool`. | The result shape or the risk level differs (keep read-only and mutating actions apart). |
| **Action** | One verb inside a tool, e.g. `search`, `fetch`. One file. | Always the default answer for a new capability. |

Namespace names the app-server reserves for OpenAI's own tools are rejected at `thread/start`
(`browser` is one; the error names the collision). Prefix with what makes ours distinct,
e.g. `embedded_browser`.

Limits enforced at startup: snake_case names, unique names, non-empty descriptions,
`type: object` schemas, at most 8 actions per tool, and a field that appears in two actions
must have the same schema in both.

## Layout

```
src/main/tools/
  tool.ts              contract + argument helpers
  action-tool.ts       defineActionTool: many action files -> one tool
  registry.ts          validation, timeouts, error handling
  app-server-tools.ts  Codex adapter (dynamicTools + item/tool/call)
  manifest.ts          renderer-facing registry snapshot for the Tools modal
  telemetry.ts         recent call stats + JSONL persistence
  index.ts             createToolRegistry: registers every namespace
  <namespace>/
    index.ts           the namespace: its verb tools
    <tool>/
      index.ts         defineActionTool({ name, description, actions: [...] })
      <action>.ts      one ToolAction: verb, description, inputSchema, run
```

## Current namespaces

These are registered in `src/main/index.ts`, after the browser/capture accessors are created and
before the app-server starts.

| Namespace | Tool | Actions | Purpose |
|---|---|---|---|
| `embedded_browser` | `page` | `navigate`, `read_page`, `wait_for` | Browser-page inspection for the pane the user can see. It can open a URL or search query, wait for page readiness, and read visible text from the whole page or one selector. |
| `closedai_ui` | `capture` | `app_window`, `browser_page` | Visual evidence. `app_window` captures the composed Electron window, including chat and browser chrome. `browser_page` captures only one browser page after deterministic readiness checks. |
| `browser_cdp` | `protocol` | `capabilities`, `targets`, `command`, `events` | Low-level Chrome DevTools Protocol access for ClosedAI tabs. See `docs/cdp-tool-foundation.md` for the lifecycle rules and handle caveats. |

The model-facing names intentionally differ from OpenAI reserved namespaces. For example,
ClosedAI uses `embedded_browser`, not `browser`.

## Writing an action

```ts
import { textResult } from '../../tool.js'
import type { ToolAction } from '../../action-tool.js'

export const search: ToolAction = {
  action: 'search',
  description: 'Search <provider>. Returns up to `limit` hits as "title — url — snippet" lines.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, description: 'Search terms.' },
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 10.' }
    },
    required: ['query'],
    additionalProperties: false
  },
  async run(input) {
    // input is already validated against inputSchema (without `action`).
    return textResult('...')
  }
}
```

Descriptions are for the model: say what it does, when to use it over its siblings, and what
comes back. Return `failureResult(...)` for expected failures so the model can recover; throw
for bugs and the registry reports them.

## How the model sees it

One tool per verb tool. Its description is the preamble followed by one section per action,
and its schema is flat: an `action` enum plus every action's fields, each annotated with which
actions require or use it. At call time the registry validates against the chosen action's
schema, so errors are precise even though the advertised schema is the union.

Codex integration is in `app-server-tools.ts`. The registry is converted to app-server
`dynamicTools` for `thread/start` and `thread/resume`, and calls arrive as `item/tool/call`.
The adapter maps registry text results to `inputText` and image results to `inputImage`.

Codex extra: set `deferLoading: true` on a rarely used tool and it stays out of context until
the model searches for it.

## Seeing what exists: the Tools modal

The wrench button in the chat header opens the Tools modal (`src/renderer/tools/`). It reads
the registry as data (`manifest.ts`): every namespace, tool, and action, the exact description
and schema the model is sent, and which providers the registry is advertised to.

The same modal owns persisted enable/disable switches. A disabled plain tool is not advertised to
providers and calls are refused. A disabled action is removed from the action enum when the action
tool supports restriction; otherwise the call is refused if the model still tries it. Toggle state
is stored in `app-settings.json` and applied before each `ChatService` starts or resumes a thread.

## Telemetry

The registry reports every call to subscribers (`registry.subscribe`). `ToolTelemetry`
(`telemetry.ts`) keeps the last 500 records in memory and appends each to
`<userData>/tool-telemetry.jsonl`, so history survives restarts. A record holds the tool,
action, argument preview, duration, success, the failure text the model saw, and the thread,
turn, and call ids. The modal shows per-tool calls, failures, average time, last call, and the
recent calls with their arguments and output; it updates live while open. "Clear telemetry"
empties both the window and the file.

Telemetry is best-effort. Subscribers must not break tool calls, and the registry swallows
subscriber errors after the model-visible result is produced.
