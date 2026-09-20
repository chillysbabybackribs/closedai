# Research library

Tools → **Research library** opens an app-shared collection of public paper titles and
abstracts. This is the first research-context slice: manual collection and bounded,
on-demand reading. It does not run experiments, synthesize findings, schedule background
agents, or modify model instructions with retrieved content.

## Collection and controls

The default topics cover agent memory/context retrieval, reliable tool use and coding-agent
evaluation, and efficient retrieval augmented generation. Nothing is fetched until the user
chooses **Update research**. Users can edit 1–5 topics of 3–200 characters, select a publication
window, disable agent retrieval, dismiss papers, or restore dismissed papers. Save configuration
changes before updating. Changes to topics/window clear the prior refresh report; removing a
topic removes its paper associations and papers with no remaining followed topic.

Refresh uses alphaXiv's public semantic discovery endpoint, the same endpoint inspected in
[OpenResearch's client](https://github.com/alphaXiv/OpenResearch/blob/05132f3c508ceb458b3805d3268558e872c17efa/src/client.rs).
Each configured topic is sent as a query with recency priority and a publication-date bound.
No project files, conversations, credentials, or model requests are involved. The nonpersistent
public Electron session omits credentials and rejects redirects. This source-specific adapter
is deliberately separate from general web search; it needs no search-provider API key.

A refresh makes at most five requests, two concurrently, with no automatic retries. Requests
have a 20-second deadline and 512 KiB response cap; the refresh has a 60-second deadline.
At most twenty valid papers per topic are accepted. IDs are validated and normalized across
arXiv versions, results are deduplicated, and matching topics are retained. The upstream search
pool is finite: a result set is discovery, not exhaustive coverage or proof of relevance.

Closing the dialog leaves an explicit update running; reopening reconnects to its state.
**Stop update** aborts it. Concurrent update requests share one operation. Successful topics
are retained on partial failure, and failures are visible per topic. A cancelled/timed-out
refresh discards its new collection, preserves existing papers, and records its outcome.
Shutdown cancels collection. Reads never initiate a refresh or model call.

## Storage and retrieval

`<userData>/research-library.json` is a bounded versioned public index, written atomically with
owner-only permissions. It persists across restarts and provider changes, independently of
the ephemeral `research-runs` cache and private investigation archives. All chats/projects can
read this explicitly shared public library when retrieval is enabled. It contains no private
chat evidence and introduces no cross-chat access to investigation artifacts.

The library retains at most 500 papers, preferring newer publication dates. Each records the
source URL, title (500 characters maximum), abstract (6,000 maximum with a truncation flag),
publication/retrieval dates, topic associations, and a SHA-256 hash of the stored title and
abstract. Loading validates schema, bounds, canonical URLs, and hashes. Corrupt or unsupported
files surface an error and are preserved rather than silently replaced. Hashes establish stored
content consistency, not truth or independent source verification.

Up to 2,000 dismissal IDs persist across refresh/restart. Restoring clears those dismissals;
papers already evicted need another refresh. Saved papers outside the current publication
window are excluded at read time. Retrieval older than seven days is marked stale; this is
a freshness hint, not an automatic refresh or a judgment that a paper's claims are obsolete.

The provider-neutral `search.library` tool has three read-only actions:

- `status`: settings, availability, counts, and the last refresh report without paper content.
- `search`: local word matching over titles and abstracts, weighting titles more strongly.
  Requires at least two query words to match (one for a one-word query). Returns five results
  by default, at most ten, each with a 400-character excerpt and dates.
- `read`: one current, undismissed saved abstract by id, including provenance and hash.

Search is lexical, not semantic; discovery at alphaXiv is semantic. A saved-library miss does
not establish that relevant research does not exist. Search/read fail when agent retrieval is
disabled. Status remains available to explain that setting. The Tools tool switches also
apply normally. Mutations are available through the user-facing IPC/UI, not this read tool.

Every result labels the scope, source, and untrusted abstract-level evidence. No library
content is injected on Send, at startup, or during session rotation. Models are directed to
use it only for relevant tasks and to read linked papers before relying on methods/claims.
There is no model-generated summary, automatic recommendation, experiment winner, or promoted
application policy in this release.

## Ownership and verification

Shared contracts live in `src/shared/research-library.ts`; the main-process provider, store,
service, and IPC handlers live in `src/main/research-library/`. The existing research runtime
owns its public session and shutdown. `src/main/tools/search/library.ts` exposes bounded reads;
`src/renderer/research/` owns the dialog/controller and `styles/research/` its styles.

Focused tests exercise parsing/transport limits, cancellation, partial failure, concurrent
refreshes, persistence, deduplication, dismissal/disable behavior, relevance/date filtering,
bounded retention/output, and storage failures. This is the foundation for a later evaluation
bench; it does not establish that retrieval improves task quality or reduces token usage.
