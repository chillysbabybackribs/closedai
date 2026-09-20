import type { ReactNode } from 'react'
import { createElement } from 'react'

export type DiffLineKind = 'meta' | 'hunk' | 'add' | 'remove' | 'context'

export type ParsedDiffLine = {
  kind: DiffLineKind
  oldNum: number | null
  newNum: number | null
  text: string
  raw: string
}

export type ParsedHunk = {
  header: string
  lines: ParsedDiffLine[]
}

export type ParsedDiff = {
  hunks: ParsedHunk[]
  additions: number
  deletions: number
}

export type SplitDiffCell = {
  num: number | null
  text: string
  kind: 'context' | 'add' | 'remove' | 'meta' | 'empty'
}

export type SplitDiffRow = {
  left: SplitDiffCell
  right: SplitDiffCell
}

const HUNK_REGEX = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)?$/
const TOKEN_REGEX = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:import|export|from|const|let|var|function|return|if|else|for|while|async|await|class|interface|type|extends|implements|try|catch|finally|throw|new|default|typeof|instanceof|switch|case|break|def|self|None|True|False|elif)\b|\b(?:true|false|null|undefined|void|boolean|number|string|any)\b|\b\d+(?:\.\d+)?\b|\b[A-Z][a-zA-Z0-9_$]*\b)/g

export function parseUnifiedDiff(rawDiff: string): ParsedDiff {
  const lines = rawDiff.split('\n')
  const hunks: ParsedHunk[] = []
  let currentHunk: ParsedHunk | null = null
  let oldLine = 1
  let newLine = 1
  let additions = 0
  let deletions = 0

  for (const line of lines) {
    const hunkMatch = line.match(HUNK_REGEX)
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1]!, 10)
      newLine = parseInt(hunkMatch[3]!, 10)
      currentHunk = { header: line, lines: [] }
      hunks.push(currentHunk)
      continue
    }

    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('\\')) {
      const metaLine: ParsedDiffLine = { kind: 'meta', oldNum: null, newNum: null, text: line, raw: line }
      if (!currentHunk) {
        currentHunk = { header: '', lines: [] }
        hunks.push(currentHunk)
      }
      currentHunk.lines.push(metaLine)
      continue
    }

    if (!currentHunk) {
      currentHunk = { header: '', lines: [] }
      hunks.push(currentHunk)
    }

    if (line.startsWith('+')) {
      additions++
      currentHunk.lines.push({
        kind: 'add',
        oldNum: null,
        newNum: newLine++,
        text: line.slice(1),
        raw: line
      })
    } else if (line.startsWith('-')) {
      deletions++
      currentHunk.lines.push({
        kind: 'remove',
        oldNum: oldLine++,
        newNum: null,
        text: line.slice(1),
        raw: line
      })
    } else {
      const text = line.startsWith(' ') ? line.slice(1) : line
      currentHunk.lines.push({
        kind: 'context',
        oldNum: oldLine++,
        newNum: newLine++,
        text,
        raw: line
      })
    }
  }

  return { hunks, additions, deletions }
}

export function alignHunkLines(lines: ParsedDiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = []
  let pendingRemoves: ParsedDiffLine[] = []
  let pendingAdds: ParsedDiffLine[] = []

  function flush(): void {
    const count = Math.max(pendingRemoves.length, pendingAdds.length)
    for (let i = 0; i < count; i++) {
      const rem = pendingRemoves[i]
      const add = pendingAdds[i]
      rows.push({
        left: rem
          ? { num: rem.oldNum, text: rem.text, kind: 'remove' }
          : { num: null, text: '', kind: 'empty' },
        right: add
          ? { num: add.newNum, text: add.text, kind: 'add' }
          : { num: null, text: '', kind: 'empty' }
      })
    }
    pendingRemoves = []
    pendingAdds = []
  }

  for (const line of lines) {
    if (line.kind === 'remove') {
      pendingRemoves.push(line)
    } else if (line.kind === 'add') {
      pendingAdds.push(line)
    } else {
      flush()
      if (line.kind === 'meta') {
        rows.push({
          left: { num: null, text: line.text, kind: 'meta' },
          right: { num: null, text: line.text, kind: 'meta' }
        })
      } else {
        rows.push({
          left: { num: line.oldNum, text: line.text, kind: 'context' },
          right: { num: line.newNum, text: line.text, kind: 'context' }
        })
      }
    }
  }
  flush()
  return rows
}

export function formatHunkRaw(hunk: ParsedHunk): string {
  const lines: string[] = []
  if (hunk.header) lines.push(hunk.header)
  for (const line of hunk.lines) {
    lines.push(line.raw)
  }
  return lines.join('\n')
}

export function highlightTokens(code: string): ReactNode[] {
  if (!code) return [' ']
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  TOKEN_REGEX.lastIndex = 0
  while ((match = TOKEN_REGEX.exec(code)) !== null) {
    if (match.index > lastIndex) {
      parts.push(code.slice(lastIndex, match.index))
    }
    const token = match[0]
    let tokenClass = ''
    if (token.startsWith('//') || token.startsWith('/*') || token.startsWith('#')) {
      tokenClass = 'diff-token-comment'
    } else if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
      tokenClass = 'diff-token-string'
    } else if (/^(?:import|export|from|const|let|var|function|return|if|else|for|while|async|await|class|interface|type|extends|implements|try|catch|finally|throw|new|default|typeof|instanceof|switch|case|break|def|self|elif)$/.test(token)) {
      tokenClass = 'diff-token-keyword'
    } else if (/^(?:true|false|null|undefined|void|boolean|number|string|any|None|True|False)$/.test(token)) {
      tokenClass = 'diff-token-literal'
    } else if (/^\d+(?:\.\d+)?$/.test(token)) {
      tokenClass = 'diff-token-number'
    } else if (/^[A-Z]/.test(token)) {
      tokenClass = 'diff-token-type'
    }
    parts.push(createElement('span', { key: match.index, className: tokenClass }, token))
    lastIndex = match.index + token.length
  }

  if (lastIndex < code.length) {
    parts.push(code.slice(lastIndex))
  }
  return parts
}
