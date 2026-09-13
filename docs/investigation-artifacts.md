# Durable investigation artifacts

Implemented 2026-09-13. This increment retains selected raw CDP responses and local files,
then lists, reads, projects, exports and deletes their bytes independently of the source.
It is the first durable substrate for the [investigation platform](investigation-platform.md),
not a completed investigation graph, coherent browser capture system or experiment laboratory.

## Use

Retain a full protocol result instead of an inline dump:

```json
{
  "action": "command",
  "tab_id": "<explicit tab id>",
  "method": "DOMSnapshot.captureSnapshot",
  "params": { "computedStyles": ["display", "color"] },
  "retain": true,
  "operation_key": "layout-observation-1",
  "label": "Layout before the change"
}
```

This is a `browser_cdp.protocol` call. The selected CDP operation retains its ordinary
semantics and may require enabling a domain. Retention adds no snapshot-coherence guarantee
and does not turn a mutating protocol command into a read. Private content in the selected
response is retained. Input methods keep the existing fallback and batch verification rules.

The result contains an artifact id, SHA-256, byte length, media type, label and acquisition
record creation time. The stored representation is compact UTF-8 JSON of the host response,
including its protocol wrapper; it is captured before the normal 16,000-character output cap.
This is exact serialized response content, not raw protocol wire bytes. Images inside a raw
response remain encoded JSON data, not a newly qualified screenshot or image-channel result.

Read a subtree with `investigation.read`:

```json
{"action":"read","id":"<artifact id>","pointer":"/result/documents/0","offset":0}
```

For JSON projection, `data` is a page of JSON text. Append subsequent `data` strings using
`nextOffset` until null, then parse the joined JSON. Offsets count UTF-16 code units and
can split a surrogate pair or escape sequence. An empty pointer selects the whole JSON
document. RFC 6901 escaping uses `~1` for `/` and `~0` for `~`. Absent properties fail
explicitly; prototype properties are never traversed. Parsing/projection runs in the worker.

Omit `pointer` to retrieve exact artifact bytes in base64 pages. Offsets then count bytes;
decode each base64 page, join the bytes, and only then decode text. Page boundaries may split
a UTF-8 sequence. `metadata: true` reads the provenance envelope as paged JSON text; a
pointer can select within that envelope. Each read revalidates the entire stored blob hash.

`investigation.read` action `list` returns compact descriptors, current limits and a
`nextAfter` cursor. Lists do not scan blob integrity. They page by immutable random artifact
id; inserts before a cursor require restarting the list. This is not a snapshot-consistent
query API. Output budgeting can return fewer entries than the requested limit.

`investigation.manage` provides:

- `import`: absolute regular-file path, `operation_key`, `label`, optional `media_type`
  (default `application/octet-stream`; use `application/json` for JSON projection). The worker
  reads bounded bytes and checks file size/mtime/ctime before and after. Final-component
  symlinks are refused where O_NOFOLLOW is supported; this is not an adversarial filesystem sandbox.
- `export`: artifact `id` and absolute destination `path`. It writes verified exact bytes,
  fsyncs a private staging file and publishes via a same-directory no-clobber hard link.
  Parent directory must exist; an existing file is never replaced. The returned descriptor
  includes the hash. An export is a single artifact, not a full archive backup format.
- `delete`: artifact `id`. Removes its metadata/reference and bytes when no surviving artifact
  in the same scope uses them. Operation tombstones prevent old keys from recreating it.
  Missing/deleted ids return `deleted: false`; other scopes are unaffected.

## Persistence and identity

The application starts one artifact worker and drains it during quit. Its separately bundled
entry is `artifact-worker.js`. The database is under the app profile at
`investigation-artifacts/artifacts.sqlite`. New directories/files use private permissions.
SQLite's WAL and FULL synchronous mode provide the underlying transactional recovery.

This first slice stores content-addressed bytes as SQLite BLOBs with metadata in the same
transaction. It deliberately differs from the earlier proposed separate blob files: there
is no two-resource publication or orphan-blob recovery boundary. External blob storage can
be introduced later with migration evidence if measured size/performance warrants it.
Deduplication never crosses chat/project scope. Quotas charge logical referenced bytes.

Host scope comes from the current caller's ChatRecord id and cwd, checked against its active
pane thread and turn. It does not come from focus, selected project, model-supplied ids or
provider thread identity. A model switch or rotation in the same chat retains access. Another
chat cannot read these artifacts. There is no automatic inheritance on branching, sharing or
scope override tool. Source data never becomes trusted model context.

Parking/hiding/detaching panes and switching projects do not delete artifacts. Archived chats
cannot access artifacts while archived; their data remains. There is no chat-delete cascade,
workspace cleanup or automatic startup reconciliation. In particular, an unreadable chat store
must not cause its retained evidence to be deleted. Delete selected artifacts before archiving
when no retention is wanted. Future archive management needs a deliberate scope lifecycle.

## Retry and cancellation contracts

Retention first commits a scoped operation key and request fingerprint, then executes the
selected acquisition, then atomically publishes bytes, metadata and its completed receipt.
Reusing a completed key with the same normalized arguments returns the original descriptor
without reading the live source or executing CDP. Changed arguments fail. Replayed receipts
prove an earlier commit; use read/export for current integrity validation.

An acquisition that fails, is cancelled or loses its process after reservation stays
`uncertain`. Retrying that key refuses to execute again. Inspect external effects before
choosing a new key. There is no exactly-once guarantee for arbitrary browser-side effects
and no rollback claim. Deleted artifacts keep a `deleted` operation tombstone.

Each worker request uses atomic cancellation state: active, cancelled, commit-admitted.
Cancellation that wins before admission prevents publication; after admission it cannot
undo the commit. A returned result can include `cancellationTiming: after-commit-admission`.
An outer provider timeout can still leave the caller uncertain; operation-key retry resolves
completed writes. Source document leases and coherent acquisition remain later work.

## Limits and qualification boundaries

Default host limits: 32 MiB/artifact, 256 MiB of referenced bytes/chat-project scope, 1 GiB
across scopes, 10,000 operation receipts/scope and 100,000 total. The facade admits at most
16 pending requests and 64 MiB of queued byte payloads. The host constructor accepts storage
limits; there is not yet a settings UI for them. Quotas are logical limits, not exact caps
on SQLite pages, WAL, metadata, runtime copies or filesystem allocation.

Read pages contain up to 6,000 bytes (base64) or 1,500 UTF-16 code units (projected JSON text).
Listings return at most 20 descriptors within their serialized budget. Raw acquisition
still materializes the protocol result and serializes it in the main process before worker
transfer; protocol streaming and worker-side acquisition are not implemented. Integrity reads
hash the full artifact in the worker on every page. Large-profile performance is unmeasured.

Schema version 1 is new; newer versions are refused. No legacy import, full consistent
backup/restore or general version migration is implemented. Artifact export is available.
Deletion is logical and does not securely erase SQLite/WAL pages, filesystem remnants,
exports or independent backups. Failed exports can leave staging files on process death;
there is no scan of arbitrary export directories or secure-erasure promise. Directory-fsync
power-loss guarantees and cross-platform qualification remain unestablished.

## Verification

Focused commands:

```sh
node --experimental-transform-types --import ./scripts/ts-resolve-hook-register.mjs --test src/main/investigations/artifact-store.test.ts src/main/investigations/artifact-service.test.ts src/main/investigations/artifact-runtime.test.ts src/main/tools/cdp/cdp.test.ts
node scripts/artifact-worker-smoke.mjs
npm run typecheck
npm run hygiene
npm run map:check
```

The packaged-worker smoke builds only main-process entries into a fresh temporary directory
and runs the emitted worker under Electron's bundled Node. It verifies retention beyond the
ordinary output cap, abrupt worker restart, projection, committed retry, exact export and
deletion. It does not launch a window, restart the user's application, touch the real profile
or call a model provider. Electron 44.1.1 / Node 24.19.0 passed this check.

An initial ad-hoc smoke failed because `--input-type` was inherited by a file-based worker;
the committed smoke clears its worker execArgv and passed. This was a harness launch error.
An additional concurrency/output-budget regression exposed zero-byte payload binding as SQL
NULL; empty artifacts now use SQLite `zeroblob(0)` and the regression passes.
SQLite and Node transform-types emitted their experimental warnings. Source-driven tool tests
use the real store and registry but synthetic protocol responses; installed browser/tool
acquisition and provider qualification remain pending after the native code is loaded.
