/* Promote bare workspace file paths in assistant prose to links, the same way remarkBareUrls
   handles hosts. Skips code and existing links so `package.json` in a sentence stays text unless
   it carries a path segment (for example `src/package.json`). */

import { isWorkspaceFileHref } from '../../shared/local-files.js'

type MdastNode = {
  type: string
  value?: string
  url?: string
  children?: MdastNode[]
}

const SKIPPED_NODES = new Set([
  'link', 'linkReference', 'definition', 'inlineCode', 'code', 'html', 'image', 'imageReference'
])

/** Relative, absolute, and ./ paths; leading \b fails before `/home/...` so use a lookbehind. */
const PATH = new RegExp(
  String.raw`(?<![A-Za-z0-9._/@])((?:\./|\.\./|(?:(?:/[A-Za-z0-9._-]+)+|[A-Za-z0-9._-]+/)[A-Za-z0-9._./-]*\.[A-Za-z0-9]+))(?![A-Za-z0-9._-])`,
  'g'
)

function trimTrailing(match: string): string {
  let end = match.length
  while (end > 0 && '.,;:!?"\''.includes(match[end - 1] as string)) end -= 1
  return match.slice(0, end)
}

function splitWorkspacePaths(value: string): MdastNode[] | null {
  PATH.lastIndex = 0
  const parts: MdastNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = PATH.exec(value))) {
    const start = match.index
    const text = trimTrailing(match[1]!)
    if (!isWorkspaceFileHref(text)) continue
    if (start > cursor) parts.push({ type: 'text', value: value.slice(cursor, start) })
    parts.push({ type: 'link', url: text, children: [{ type: 'text', value: text }] })
    cursor = start + match[1]!.length
    PATH.lastIndex = cursor
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
      const parts = splitWorkspacePaths(child.value)
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

export function remarkWorkspaceFilePaths() {
  return (tree: MdastNode): void => { transform(tree) }
}
