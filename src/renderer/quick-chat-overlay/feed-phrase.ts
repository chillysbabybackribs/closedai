import type { ActivityItem } from '../transcript-rows.js'

// Plain words for the steps a quick chat takes while it drives the page, so the running feed reads
// "Opened espn.com" rather than a tool's namespaced name. Only the tools a page task uses are named
// here; anything else keeps the transcript's own step line.

type Phrase = { live: string; done: string }

const PHRASES: Record<string, (args: ToolArgs) => Phrase> = {
  'embedded_browser page': ({ action, url }) =>
    action === 'navigate' ? verb('Opening', 'Opened', host(url) ?? 'a page')
      : action === 'wait_for' ? verb('Waiting for', 'Waited for', 'the page')
        : verb('Reading', 'Read', 'the page'),
  'embedded_browser script': ({ action, url }) =>
    action === 'fetch' ? verb('Fetching', 'Fetched', host(url) ?? 'from the page')
      : action === 'extract' ? verb('Extracting', 'Extracted', 'from the page')
        : action === 'query' ? verb('Searching', 'Searched', 'the page')
          : action === 'console' ? verb('Reading', 'Read', 'the page console')
            : verb('Working', 'Worked', 'in the page'),
  'embedded_browser network': () => verb('Watching', 'Watched', 'network traffic'),
  'embedded_browser network_replay': () => verb('Replaying', 'Replayed', 'a request'),
  'embedded_browser session': () => verb('Checking', 'Checked', 'the browser session'),
  'browser_cdp page': () => verb('Controlling', 'Controlled', 'the page'),
  'browser_cdp protocol': () => verb('Controlling', 'Controlled', 'the page'),
  'browser_cdp emulate': () => verb('Emulating', 'Emulated', 'a device'),
  'closedai_ui capture': () => verb('Taking', 'Took', 'a screenshot'),
  'closedai_app state': () => verb('Checking', 'Checked', 'the app'),
  'closedai_app command': () => verb('Running', 'Ran', 'an app command'),
  'closedai_app ui': () => verb('Using', 'Used', 'the app'),
  'closedai_app menu': () => verb('Using', 'Used', 'an app menu'),
  'search query': () => verb('Searching', 'Searched', 'the web'),
  'search run': () => verb('Researching', 'Researched', 'the web'),
  'search read': ({ url }) => verb('Reading', 'Read', host(url) ?? 'a web page'),
  'tool search': () => verb('Loading', 'Loaded', 'tools'),
  'media video': () => verb('Recording', 'Recorded', 'a video')
}

type ToolArgs = { action: string | null; url: string | null }

/** The feed's words for a tool step, or null when the transcript's own line should stand. */
export function feedToolPhrase(item: ActivityItem, live: boolean): string | null {
  if (item.type !== 'tool') return null
  const phrase = PHRASES[toolKey(item.label)]
  if (!phrase) return null
  const words = phrase({ action: argument(item.detail, 'action') ?? argument(item.detail, 'op'), url: argument(item.detail, 'url') })
  return live ? words.live : words.done
}

/** "embedded_browser · page", "mcp__embedded_browser__page" and "embedded_browser.page" alike. */
function toolKey(label: string): string {
  return label.trim().toLowerCase()
    .replace(/^mcp__/, '')
    .replace(/\s*·\s*|__|\./g, ' ')
    .replace(/\s+/g, ' ')
}

/** One string argument from the step's arguments, which the adapter may have clipped mid-JSON. */
function argument(detail: string, name: string): string | null {
  const match = new RegExp(`"${name}"\\s*:\\s*"([^"]{1,300})"`).exec(detail)
  return match?.[1] ?? null
}

function host(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

function verb(live: string, done: string, subject: string): Phrase {
  return { live: `${live} ${subject}`, done: `${done} ${subject}` }
}
