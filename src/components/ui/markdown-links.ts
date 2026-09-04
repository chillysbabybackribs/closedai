/* remark-gfm autolinks only literals that already carry a scheme or a `www.` label, so a
   model that writes a bare host — `untitledui.com`, `tailwindcss.com/plus` — leaves dead text
   in the transcript. This transformer promotes those to real link nodes so every referenced
   URL reaches the markdown `a` renderer and opens in the app browser.

   Hosts are accepted only against a curated TLD list. Anything outside it stays text, which
   keeps `chat-transcript.tsx`, `package.json`, and `foo.py` from becoming links, and drops the
   ccTLDs that collide with ordinary words after a missing space (`.is`, `.it`, `.in`, `.at`). */

type MdastNode = {
  type: string
  value?: string
  url?: string
  children?: MdastNode[]
}

const SKIPPED_NODES = new Set([
  'link', 'linkReference', 'definition', 'inlineCode', 'code', 'html', 'image', 'imageReference'
])

const TLDS = new Set([
  'com', 'org', 'net', 'edu', 'gov', 'mil', 'int', 'info', 'biz', 'pro',
  'io', 'ai', 'dev', 'app', 'co', 'me', 'so', 'sh', 'gg', 'tv', 'fm', 'ly', 'cc', 'xyz',
  'tech', 'cloud', 'design', 'studio', 'tools', 'works', 'page', 'site', 'space', 'blog',
  'news', 'wiki', 'live', 'media', 'agency', 'digital', 'systems', 'network', 'software',
  'solutions', 'ventures', 'capital', 'finance', 'health', 'group', 'team', 'chat', 'email',
  'link', 'run', 'new', 'ca', 'uk', 'eu', 'de', 'fr', 'nl', 'se', 'dk', 'fi', 'pl', 'cz',
  'jp', 'kr', 'cn', 'hk', 'sg', 'au', 'nz', 'br', 'mx', 'ar', 'cl', 'za', 'ch', 'pt', 'gr'
])

const CANDIDATE = /(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,12}(?::\d{2,5})?(?:\/[^\s<>"'`]*)?/gi

/* A match may not continue a larger token: an existing URL tail, an email address, or a path
   segment all present a host-shaped run that is already spoken for. */
const LEADING_BOUNDARY = /[A-Za-z0-9./@\-_:~]/

function tld(match: string): string {
  const host = match.split(/[/:]/, 1)[0] ?? ''
  return (host.split('.').pop() ?? '').toLowerCase()
}

/* Prose punctuation binds tighter than the URL: `see foo.com.` and `(foo.com/a)` both end with
   characters the sentence owns, not the link. */
function trimTrailing(match: string): string {
  let end = match.length
  while (end > 0) {
    const character = match[end - 1] as string
    if ('.,;:!?"\''.includes(character)) { end -= 1; continue }
    if (character === ')') {
      const slice = match.slice(0, end)
      const opened = (slice.match(/\(/g) ?? []).length
      const closed = (slice.match(/\)/g) ?? []).length
      if (closed > opened) { end -= 1; continue }
    }
    break
  }
  return match.slice(0, end)
}

function splitBareUrls(value: string): MdastNode[] | null {
  CANDIDATE.lastIndex = 0
  const parts: MdastNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = CANDIDATE.exec(value))) {
    const start = match.index
    const previous = start > 0 ? (value[start - 1] as string) : ''
    if (previous && LEADING_BOUNDARY.test(previous)) continue

    const text = trimTrailing(match[0])
    if (!text || !TLDS.has(tld(text))) continue

    if (start > cursor) parts.push({ type: 'text', value: value.slice(cursor, start) })
    parts.push({ type: 'link', url: `https://${text}`, children: [{ type: 'text', value: text }] })
    cursor = start + text.length
    CANDIDATE.lastIndex = cursor
  }

  if (!parts.length) return null
  if (cursor < value.length) parts.push({ type: 'text', value: value.slice(cursor) })
  return parts
}

function transform(node: MdastNode): void {
  if (!node.children) return
  const next: MdastNode[] = []
  let changed = false

  for (const child of node.children) {
    if (SKIPPED_NODES.has(child.type)) {
      next.push(child)
      continue
    }
    if (child.type === 'text' && typeof child.value === 'string') {
      const parts = splitBareUrls(child.value)
      if (parts) {
        next.push(...parts)
        changed = true
        continue
      }
      next.push(child)
      continue
    }
    transform(child)
    next.push(child)
  }

  if (changed) node.children = next
}

/** Runs after remark-gfm, so scheme and `www.` literals are already links and are skipped. */
export function remarkBareUrls() {
  return (tree: MdastNode): void => {
    transform(tree)
  }
}
