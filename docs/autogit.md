# Auto-git

`scripts/autogit.mjs` snapshots the working tree into commits so nobody has to think about
git. After `npm run autogit:install`, it runs as a systemd user service whenever you are logged in.

## What it does

Watches the repository. After 20 seconds of quiet (or at most 3 minutes after the first
change), it stages every eligible change and commits with a message like
`auto: src/renderer/tools (4), docs (1)`. The commit body lists the files and the result of
a typecheck, so `git log` doubles as a "last known good" index. A 60-second tick catches
anything the watcher missed.

## What it will never do

This is the whole point. Earlier auto-git attempts broke apps because they did more than
snapshot.

- Its normal snapshot mutations are only `git add` and `git commit`. Never checkout, reset,
  stash, pull, rebase, merge, or switch branches. The working tree is never rewritten. An
  explicit `AUTOGIT_PUSH=1` additionally permits `git push` after a successful commit.
- Commits to the branch that is checked out. Refuses on a detached HEAD or during a
  merge, rebase, cherry-pick, revert, or bisect.
- Refuses to stage secrets (`.env`, keys, tokens, `auth.json`, anything named like a
  credential) and files over 5 MB. They stay unstaged and are named in the commit body.
- One instance per repository, and it waits out git's own `index.lock` instead of fighting it.
- No push unless `AUTOGIT_PUSH=1` is set and the branch has an upstream.

## Commands

```bash
npm run autogit            # watch and commit (what the service runs)
npm run autogit:once       # commit now if there is anything to commit
npm run autogit:status     # show what would be committed
npm run autogit:install    # install + start the user service
npm run autogit:uninstall  # stop + remove it
journalctl --user -u closedai-autogit -f   # live log
```

Env: `AUTOGIT_QUIET_MS` (20000), `AUTOGIT_MAX_WAIT_MS` (180000), `AUTOGIT_VERIFY` (1),
`AUTOGIT_PUSH` (0).

## Working with it

- Snapshots are fine-grained and honest, not curated. When you want a clean history for a
  release, squash on a branch; the snapshots stay as the record of what actually happened.
- To find the last commit whose typecheck passed: `git log --grep='Typecheck: ok' -1`.
- To undo a change, use `git revert` or `git checkout <hash> -- <path>`; auto-git will
  snapshot that too. It never does either on its own.
