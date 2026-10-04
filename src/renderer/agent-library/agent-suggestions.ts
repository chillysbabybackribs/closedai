// Starting points shown on the Build screen while the description is empty. Clicking one fills
// the description with text the user then edits and optimizes; nothing is started or saved. The
// pool is curated and rotates, so each visit shows different ideas from different categories and
// the whole pool comes round before any idea repeats. Descriptions name no files, commands, or
// tools, because the builder does not know the user's project; the optimizer tells the agent to
// find those out.

export type AgentSuggestion = {
  id: string
  category: string
  title: string
  /** One line under the title on the card. */
  blurb: string
  /** What clicking the card writes into the description. */
  description: string
}

export const AGENT_SUGGESTION_COUNT = 4

export const AGENT_SUGGESTIONS: readonly AgentSuggestion[] = [
  {
    id: 'coverage-gaps', category: 'Test coverage', title: 'Close coverage gaps',
    blurb: 'Tests for the least-covered code, one module per cycle',
    description: 'Raise test coverage in this project one module at a time. Each cycle, find the module that matters most and is tested least, write focused tests for what it is supposed to do (no tests that only run lines to move the number), and run the suite. Do not change non-test code. If a test shows a real bug, write it down for me instead of fixing it. Stop when every module I would care about has meaningful tests.'
  },
  {
    id: 'flaky-tests', category: 'Test coverage', title: 'Hunt flaky tests',
    blurb: 'Rerun the suite, find tests that fail intermittently, fix the cause',
    description: 'Find and fix flaky tests. Run the test suite several times, note every test that passes on one run and fails on another, and work through them one per cycle: find the cause (timing, shared state, test order, real clocks or network), fix the test or its setup, and rerun it enough times to be confident. Do not delete or skip a test to make it pass. Keep a list of what was flaky, why, and what changed.'
  },
  {
    id: 'dead-code', category: 'Code health', title: 'Remove dead code',
    blurb: 'Unused exports, files, and dependencies, verified before removal',
    description: 'Clean up dead code in this project. Each cycle, find one group of things nothing uses any more (unused exports, unreachable branches, files nothing imports, leftover feature flags) and confirm it is really unused by searching every reference, including tests, scripts, configuration, and dynamic lookups. Remove it, then run the type check and tests. Skip anything you cannot prove is unused and list it for me instead. Small, separate changes that are easy to review.'
  },
  {
    id: 'todo-sweep', category: 'Code health', title: 'Work through the TODOs',
    blurb: 'Triage every TODO and FIXME, resolve the ones that are safe',
    description: 'Go through every TODO, FIXME, and HACK comment in the code. Build a list with where each one is and what it asks for, then take one per cycle: if it is small and clearly safe, do it and remove the comment; if it is already done, remove the comment; if it needs a decision from me or is too large, leave it and record why. Run the relevant tests after each change. I want a final list of what was done, what was stale, and what is left for me.'
  },
  {
    id: 'type-safety', category: 'Code health', title: 'Tighten the types',
    blurb: 'Replace loose types and unchecked casts with real ones',
    description: 'Improve type safety in this project. Each cycle, pick one file or module with loose typing (any, unchecked casts, missing return types, ignored type errors), replace it with accurate types, and fix what the type checker then reports. Behavior must not change: this is typing only, no refactors. Run the type check and the tests for the touched code after each change. Start with the code that other modules depend on most.'
  },
  {
    id: 'docs-drift', category: 'Docs upkeep', title: 'Fix docs that drifted',
    blurb: 'Check each doc page against the code and correct what is stale',
    description: 'Bring the documentation back in line with the code. Each cycle, take one documentation page or section, check every claim in it against the current code (names, options, defaults, commands, file paths, behavior), and correct what is wrong or out of date. Do not rewrite for style and do not document things that are not in the code. When the code looks wrong and the doc looks right, leave both and note it for me. Finish when every page has been checked once.'
  },
  {
    id: 'api-reference', category: 'Docs upkeep', title: 'Document the public API',
    blurb: 'Doc comments for exported functions that have none',
    description: 'Add documentation comments to the public API of this project. Each cycle, take one module, and for every exported function, type, or class that has no doc comment or a misleading one, write one that says what it does, what its parameters and result mean, and anything a caller would get wrong without being told. Read the implementation and its callers first so the comment is true. Match the comment style already used in the project. Do not change any code, only comments.'
  },
  {
    id: 'dependency-review', category: 'Dependency review', title: 'Review dependencies',
    blurb: 'Outdated, unused, and risky packages, with a recommendation for each',
    description: 'Review this project\'s dependencies and write me a report. For each direct dependency, find out whether it is still used, how far behind the latest release it is, whether the newer versions have breaking changes that affect how we use it, and whether it has known security advisories. Do not upgrade or remove anything: this run only reads and reports. Work through a few dependencies per cycle and keep the report sorted so the most urgent ones are first, each with a clear recommendation and the evidence for it.'
  },
  {
    id: 'safe-upgrades', category: 'Dependency review', title: 'Apply safe upgrades',
    blurb: 'Patch and minor updates one at a time, tests after each',
    description: 'Upgrade dependencies that are safe to upgrade. Take one dependency per cycle, patch and minor versions only, read its changelog for anything that affects how we use it, apply the upgrade, and run the type check and the full tests. If anything fails, undo that upgrade and record why. Leave major version upgrades alone and list them for me with what would have to change. Do not commit; leave each upgrade as a change I can review.'
  },
  {
    id: 'ui-states', category: 'UI checks', title: 'Check every screen state',
    blurb: 'Empty, loading, error, and overflow states, screen by screen',
    description: 'Check the user interface screen by screen for states that are easy to miss. For each screen, look at how it handles nothing to show, loading, an error, very long text, and many items, and note anything that breaks, overflows, misleads, or has no message at all. One screen per cycle. Fix small, obvious problems and run the related tests; for anything larger, describe the problem and where it is. Keep a checklist of screens so I can see what has been covered.'
  },
  {
    id: 'accessibility', category: 'UI checks', title: 'Audit accessibility',
    blurb: 'Labels, keyboard access, focus order, and contrast',
    description: 'Audit the user interface for accessibility problems. One screen or component per cycle: check that every interactive control has an accessible name, can be reached and operated from the keyboard, shows where focus is, and that text has enough contrast. Fix the clear-cut problems (missing labels, controls that cannot be reached by keyboard) and run the related tests. Record anything that needs a design decision instead of guessing. Keep a list of what was checked and what was found.'
  },
  {
    id: 'research-brief', category: 'Research', title: 'Research a topic in depth',
    blurb: 'Read primary sources and build a cited brief over several cycles',
    description: 'Research this topic for me and write a brief: [replace with the topic and what I need to decide]. Work in cycles: first map the questions that need answering, then take one question per cycle, read primary sources (official documentation, papers, release notes) in preference to summaries, and add what you find to the brief with a link and a date for every claim. Say plainly where sources disagree or where you could not find an answer. Finish with a short summary of what is established, what is uncertain, and what you would recommend.'
  },
  {
    id: 'compare-options', category: 'Research', title: 'Compare the options',
    blurb: 'A sourced comparison table for a choice you have to make',
    description: 'Compare these options for me: [replace with the options and what they are for]. Decide the criteria that matter for this choice first and tell me what they are, then research one option per cycle against every criterion using its own documentation, pricing pages, and release notes, with a link and date for each fact. Build a comparison I can read in a few minutes, mark anything you could not verify, and end with which option fits which situation. Do not recommend one before all of them have been researched.'
  },
  {
    id: 'error-handling', category: 'Reliability', title: 'Review error handling',
    blurb: 'Swallowed errors, missing timeouts, and unhelpful messages',
    description: 'Review how this project handles failure. Each cycle, take one module that talks to something that can fail (the network, the file system, a database, another process, user input) and look for errors that are swallowed, failures with no timeout or retry limit, messages that would not help the person who sees them, and cleanup that is skipped when something throws. Fix what is small and clearly correct, with a test where one fits, and write up the rest with the file and the risk. Do not change behavior that callers depend on.'
  },
  {
    id: 'log-noise', category: 'Reliability', title: 'Make the logs useful',
    blurb: 'Cut noise, add the context a failure needs, keep secrets out',
    description: 'Improve this project\'s logging. Each cycle, take one area and read its log statements as someone debugging a failure would: remove or demote lines that say nothing, add the identifiers and values that are needed to understand an error, make levels consistent with how the rest of the project uses them, and make sure nothing logs secrets, tokens, or personal data. Keep changes to logging only. Record any place where a failure currently leaves no trace at all.'
  },
  {
    id: 'slow-paths', category: 'Performance', title: 'Find the slow paths',
    blurb: 'Measure first, then fix one hot spot per cycle',
    description: 'Find and fix performance problems, measuring before and after. First find out how to measure this project (existing benchmarks, profiling tools, timing a realistic run) and record a baseline. Then each cycle, take the largest hot spot, find out why it is slow, make one change, and measure again. Keep the change only if the measurement improves and the tests still pass; otherwise undo it and note what you learned. No speculative rewrites, and no change that trades correctness for speed.'
  },
  {
    id: 'bundle-size', category: 'Performance', title: 'Trim startup and size',
    blurb: 'What loads at startup that does not need to',
    description: 'Reduce what this project loads at startup. Find out what is loaded or executed before the user can do anything, how large the built output is, and which parts are the biggest. Each cycle, take the largest item that is not needed immediately and defer it, split it, or remove it, then check that the project still builds, the tests pass, and the measured size or startup time went down. Keep a table of each change with the before and after numbers.'
  },
  {
    id: 'security-pass', category: 'Security', title: 'Run a security pass',
    blurb: 'Input handling, secrets, and permissions, reported with evidence',
    description: 'Review this project for security problems and report what you find. Each cycle, take one area (input validation, authentication and permissions, secrets in code or configuration, file and path handling, calls to a shell or a database, dependencies with advisories) and look for concrete, exploitable problems, not style. For each finding give the file, how it could be misused, and how sure you are. Do not change code in this run and do not test anything against systems outside this project; I will decide what to fix.'
  },
  {
    id: 'bug-triage', category: 'Bug triage', title: 'Reproduce reported bugs',
    blurb: 'Turn each report into a failing test or a clear "cannot reproduce"',
    description: 'Work through these bug reports: [replace with the reports, or where they are listed]. One report per cycle: try to reproduce it, and if you can, write a failing test that captures it and find the cause. Fix it only when the fix is small and clearly right, then run the tests. If you cannot reproduce it, say exactly what you tried. Keep a table of every report with its status (fixed, reproduced but not fixed, cannot reproduce) and what I would need to do next.'
  },
  {
    id: 'release-notes', category: 'Writing', title: 'Draft release notes',
    blurb: 'Read the changes since the last release and explain them for users',
    description: 'Draft release notes for the changes since the last release. Read the commit history and the changed code, group the changes by what a user would notice (new, improved, fixed, removed, needs action), and write each one in plain language from the user\'s point of view. Leave out internal changes that users cannot see. Check each note against the code so it is true, and mark anything you are unsure about for me. Write the draft to a file and do not publish or commit anything.'
  }
]

/** A source of numbers in [0, 1), as Math.random. */
export type RandomSource = () => number

function shuffled<T>(items: readonly T[], random: RandomSource): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    const held = result[index]!
    result[index] = result[other]!
    result[other] = held
  }
  return result
}

/**
 * Up to `count` ideas from different categories, in random order. Ideas in `avoid` (the ones seen
 * most recently) are used only when nothing else is left.
 */
export function pickSuggestions(pool: readonly AgentSuggestion[], count: number, random: RandomSource, avoid: ReadonlySet<string> = new Set()): AgentSuggestion[] {
  const order = shuffled(pool, random)
  const candidates = [...order.filter((idea) => !avoid.has(idea.id)), ...order.filter((idea) => avoid.has(idea.id))]
  const picked: AgentSuggestion[] = []
  const categories = new Set<string>()
  for (const idea of candidates) {
    if (picked.length === count) break
    if (categories.has(idea.category)) continue
    picked.push(idea)
    categories.add(idea.category)
  }
  // A pool with fewer categories than cards still fills the row.
  for (const idea of candidates) {
    if (picked.length === count) break
    if (!picked.includes(idea)) picked.push(idea)
  }
  return picked
}

export type SuggestionRotation = {
  /** The next set: different from the last one, and from every set since the pool last came round. */
  next(): AgentSuggestion[]
}

/** Deals sets from the pool, remembering what was shown so nothing repeats until the pool runs out. */
export function createSuggestionRotation(pool: readonly AgentSuggestion[], count: number, random: RandomSource = Math.random): SuggestionRotation {
  let seen = new Set<string>()
  let last = new Set<string>()
  return {
    next: () => {
      // Too few unseen ideas for a full set: a new round starts, and only the last set stays out of it.
      if (pool.filter((idea) => !seen.has(idea.id)).length < count) seen = new Set(last)
      const picked = pickSuggestions(pool, count, random, seen)
      last = new Set(picked.map((idea) => idea.id))
      for (const id of last) seen.add(id)
      return picked
    }
  }
}
