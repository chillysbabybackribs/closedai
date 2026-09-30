# Workspace ledger pilot (isolated)

Experimental regex-gated `closedai.workspace.ledger` context. **Not** connected to live sends,
`harness:live`, or `harness-sim` model runs.

## Run

```bash
npm run test:pilot:workspace-ledger
```

Implementation: `src/main/chat-context/workspace-ledger-pilot/`.

Main CI (`npm test`) skips `*.pilot.test.ts` files so this pilot does not collide with the default
suite or provider harnesses.

## Promote

After A/B validation, wire `buildWorkspaceLedgerAdditionalContext` into `buildTurnSendContext`
and add host hooks that populate the ledger from `fileChange` and verification commands.
