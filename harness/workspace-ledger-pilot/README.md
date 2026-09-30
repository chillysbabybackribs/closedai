# Workspace ledger pilot (isolated)

Experimental regex-gated `closedai.workspace.ledger` context. **Wired** into live sends via
`workspace-ledger/runtime.ts` (toggle `chatWorkspaceLedgerEnabled` in app settings). This harness
stays isolated from `harness:live` and `harness-sim` model runs.

## Run

```bash
npm run test:pilot:workspace-ledger
```

Deterministic A/B cases live in `prompt-fixtures.json` (scroller-style read-only prompts, ledger
on/off, browser false-positive guard). Fixtures tagged `noPathHints` must attach via the regex
gate only — no `src/…` tokens in the user message; warmed-store cases still inject `fresh` paths
from the ledger. For live model A/B, use `liveModel: true` rows in a **new** chat with ledger on
vs `chatWorkspaceLedgerEnabled: false` after restart. Stress limits are covered in
`ledger-stress.pilot.test.ts` (store cap, hint priority, stale storms, JSON cap). Pilot tests
load those fixtures; no `harness:model` or live send required for CI.

Implementation: `src/main/chat-context/workspace-ledger-pilot/`.

Main CI (`npm test`) skips `*.pilot.test.ts` files so this pilot does not collide with the default
suite or provider harnesses.

## Promote

After A/B validation, wire `buildWorkspaceLedgerAdditionalContext` into `buildTurnSendContext`
and add host hooks that populate the ledger from `fileChange` and verification commands.
