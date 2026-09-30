// The human side of the registry: what each tool is called, what it does for the user, what
// switching it off changes, and which effect group it belongs to. The registry stays the source
// of truth for what exists; this table only describes it. A tool missing here still appears in
// the Tools dialog under a generated name, and the catalog test keeps that from lasting long.

import type { ToolEffect, ToolGroupInfo } from '../../shared/tools.js'
import type { ToolDefinition } from './tool.js'

export type ToolCatalogEntry = {
  label: string
  summary: string
  offEffect: string
  group: ToolEffect
}

export const TOOL_GROUPS: readonly ToolGroupInfo[] = [
  { id: 'reads-web', label: 'Read the web', effect: 'Reads only', summary: 'Open pages, search, and read sources. Nothing is changed on any site.' },
  { id: 'acts-in-browser', label: 'Act in the browser', effect: 'Acts as you', summary: 'Runs code and requests inside your signed-in tabs. Sites see it as you.' },
  { id: 'controls-app', label: 'Control ClosedAI', effect: 'Controls the app', summary: 'Read app state, open chats, switch models, press buttons, take screenshots.' },
  { id: 'reads-secrets', label: 'Your secrets', effect: 'Reads secrets', summary: 'Decrypts credentials from the vault for a task you asked for.' },
  { id: 'runs-native', label: 'This machine', effect: 'Runs native code', summary: 'Attaches to local processes and can inject code. Can crash the target.' }
]

const DROPPED = 'Calls are refused at once and the tool is not offered to new chats.'

export const TOOL_CATALOG: Readonly<Record<string, ToolCatalogEntry>> = {
  'embedded_browser.page': { group: 'reads-web', label: 'Browse a page', summary: 'Open a URL in the browser pane and read what is on it.', offEffect: 'The model cannot open or read pages in the browser pane. Web search still works.' },
  'search.query': { group: 'reads-web', label: 'Web search', summary: 'Look things up across several search providers.', offEffect: 'No public web lookups. Pages already open can still be read.' },
  'search.run': { group: 'reads-web', label: 'Research runs', summary: 'Read many sources in parallel and keep what was found.', offEffect: 'No parallel research; single searches and page reads still work.' },
  'search.read': { group: 'reads-web', label: 'Research results', summary: 'Read the sources and excerpts a research run collected.', offEffect: 'Research runs can start but their findings cannot be read back.' },
  'site.discover': { group: 'reads-web', label: 'Site bootstrap', summary: 'Probe robots, sitemap, llms.txt, OpenAPI hints, and nav links for an origin before deep reading.', offEffect: 'No structured site card; the model must guess discovery paths itself.' },

  'embedded_browser.script': { group: 'acts-in-browser', label: 'Run page scripts', summary: 'Fetch, extract, or evaluate JavaScript inside the open page.', offEffect: 'The model can still read pages but cannot execute code or same-origin requests in them.' },
  'embedded_browser.session': { group: 'acts-in-browser', label: 'Signed-in requests', summary: 'Call a site’s API or read and write cookies using your existing login.', offEffect: 'No requests or cookie changes with your session outside a page.' },
  'embedded_browser.network': { group: 'acts-in-browser', label: 'Network log and rules', summary: 'See the requests pages make, and block, redirect, or rewrite headers.', offEffect: 'No request log and no traffic rules. DevTools capture still records bodies.' },
  'embedded_browser.network_replay': { group: 'acts-in-browser', label: 'Replay a request', summary: 'Send a captured request again, with edits. Can repeat a mutation.', offEffect: 'Captured requests can be read but never re-sent.' },
  'browser_cdp.page': { group: 'acts-in-browser', label: 'DevTools page input', summary: 'Inspect a page semantically and, as a last resort, click and type through DevTools.', offEffect: 'No real input through the DevTools protocol. App controls and page scripts remain.' },
  'browser_cdp.protocol': { group: 'acts-in-browser', label: 'Raw DevTools protocol', summary: 'Send any DevTools command, list targets, and read captured request bodies.', offEffect: 'No raw protocol access or captured bodies. Profiling and emulation still work.' },
  'browser_cdp.profile': { group: 'acts-in-browser', label: 'Profile a page', summary: 'Measure script, style, and memory cost of the open page.', offEffect: 'No coverage or heap profiling.' },
  'browser_cdp.instrument': { group: 'acts-in-browser', label: 'Record page APIs', summary: 'Hook fetch, storage, and other APIs before a page runs and record what it does.', offEffect: 'No pre-document recorders are installed in pages.' },
  'browser_cdp.emulate': { group: 'acts-in-browser', label: 'Emulate a device', summary: 'Change viewport, user agent, locale, network speed, and more for the open page.', offEffect: 'Pages always render as this desktop.' },

  'closedai_app.state': { group: 'controls-app', label: 'App state', summary: 'Read which chats, tabs, models, downloads, and dialogs are open.', offEffect: 'The model works blind to the app around it; commands become guesswork.' },
  'closedai_app.command': { group: 'controls-app', label: 'App commands', summary: 'Open chats, message other panes, switch models, manage browser tabs, switch project.', offEffect: 'The model cannot drive the app or other chats. Browser tools keep working in its own tab.' },
  'closedai_app.menu': { group: 'controls-app', label: 'App menu', summary: 'Run any File, View, Agent, or Developer menu row: views, dialogs, layouts, zoom.', offEffect: 'Menu rows are reached only by clicking through the menu.' },
  'closedai_app.agent': { group: 'controls-app', label: 'Agent runs', summary: 'Start, pause, resume, or stop the standing agent loop on another chat pane.', offEffect: 'The model cannot drive multi-cycle agent runs on other panes.' },
  'closedai_app.ui': { group: 'controls-app', label: 'Click the app', summary: 'List real controls and press them when no command can do the job.', offEffect: 'No real clicks or typing in ClosedAI itself.' },
  'media.video': { group: 'controls-app', label: 'Render videos', summary: 'Record a workspace page to an MP4 with ffmpeg and play it in the browser pane.', offEffect: 'No videos are rendered; pages can still be previewed and captured.' },
  'closedai_ui.capture': { group: 'controls-app', label: 'Screenshots', summary: 'Capture the app window or a page for visual checks.', offEffect: 'No visual evidence; the model relies on text and structure only.' },
  'peer_chats.list': { group: 'controls-app', label: 'List other chats', summary: 'See which chats are open or in history and what they are doing.', offEffect: 'Other chats are invisible, so they cannot be read or messaged by id.' },
  'peer_chats.read': { group: 'controls-app', label: 'Read another chat', summary: 'Page through another chat’s transcript in bounded excerpts.', offEffect: 'Other chats can be listed but not read.' },
  'peer_chats.recall': { group: 'controls-app', label: 'Recall past conversations', summary: 'Search earlier turns of this chat or a previous conversation.', offEffect: 'Nothing beyond the current context can be recalled after rotation.' },
  'peer_chats.search': { group: 'controls-app', label: 'Search recent chat index', summary: 'Find phrase matches across the hot global chat spine index.', offEffect: 'Cross-chat phrase lookup falls back to metadata search and per-chat recall only.' },
  'peer_chats.spine': { group: 'controls-app', label: 'Read conversation spine', summary: 'Turn-shaped user/assistant read of this chat or a previous one.', offEffect: 'Cross-chat synthesis falls back to search plus item-by-item recall only.' },
  'notes.list': { group: 'controls-app', label: 'List notes', summary: 'See your notes and which ones a notepad window has open.', offEffect: 'Notes other than the one a notepad chat is about stay hidden.' },
  'notes.read': { group: 'controls-app', label: 'Read notes', summary: 'Read a note as numbered lines.', offEffect: 'Only the active note a notepad chat carries is visible; long notes are cut short.' },
  'notes.edit': { group: 'controls-app', label: 'Edit notes', summary: 'Change a note; the edit lands live in your editor with the lines marked.', offEffect: 'Models can read notes but never change them.' },
  'notes.create': { group: 'controls-app', label: 'Create notes', summary: 'Add a note, opened as a new tab in the notepad window the chat belongs to.', offEffect: 'Models cannot add notes.' },
  'tool_batch.run': { group: 'controls-app', label: 'Batch tool calls', summary: 'Run several tools in one request, in order or in parallel.', offEffect: 'Every tool call is its own round trip; more passes per task.' },
  'credential_vault.list': { group: 'reads-secrets', label: 'List credentials', summary: 'Masked names and field ids only, never a secret value.', offEffect: 'The model cannot discover which credentials exist, so it cannot ask for one.' },
  'credential_vault.read': { group: 'reads-secrets', label: 'Read a credential', summary: 'Decrypt one field for immediate use in a task you asked for. Redacted in the trace.', offEffect: 'No secret leaves the vault for any model.' },

  'native_instrument.query': { group: 'runs-native', label: 'List processes', summary: 'See which local processes could be inspected and what the controller can do.', offEffect: 'Local processes are invisible to the model.' },
  'native_instrument.inspect': { group: 'runs-native', label: 'Inspect a process', summary: 'Attach to a local process and read its modules, threads, and memory.', offEffect: 'No attaching to local processes.' },
  'native_instrument.probe': { group: 'runs-native', label: 'Custom probes', summary: 'Inject a script into a local process. Can modify or crash it.', offEffect: 'No code is injected into local processes.' }
}

/** Tool ids the Read-only preset leaves on: they observe the web and the app, never act for the user. */
export const READ_ONLY_TOOL_IDS: readonly string[] = [
  ...Object.entries(TOOL_CATALOG).filter(([, entry]) => entry.group === 'reads-web').map(([id]) => id),
  'closedai_app.state',
  'closedai_ui.capture',
  'peer_chats.list',
  'peer_chats.read',
  'peer_chats.recall',
  'peer_chats.search',
  'peer_chats.spine',
  'notes.list',
  'notes.read'
]

export function catalogEntry(id: string): ToolCatalogEntry {
  const entry = TOOL_CATALOG[id]
  if (entry) return entry
  const name = id.split('.').pop() ?? id
  return {
    label: name.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
    summary: '',
    offEffect: DROPPED,
    group: 'controls-app'
  }
}

/**
 * Tokens a tool adds to every turn, as characters / 4 of what an adapter sends: the qualified
 * name, the description, and the JSON schema. Adapters differ by a few percent; this is the
 * number that tells the user whether a switch is worth flipping, not a bill.
 */
export function estimateToolTokens(namespace: string, tool: ToolDefinition): number {
  const text = JSON.stringify({ name: `${namespace}.${tool.name}`, description: tool.description, parameters: tool.inputSchema })
  return Math.ceil(text.length / 4)
}

/** What a deferred tool costs before the model loads it: its name in a list. */
export function deferredStubTokens(namespace: string, tool: ToolDefinition): number {
  return Math.ceil(`${namespace}.${tool.name}`.length / 4) + 4
}
