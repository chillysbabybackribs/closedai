import type { JSX, ReactNode } from 'react'
import { memo, useMemo, useState } from 'react'
import { Check, Copy, FileCode } from 'lucide-react'

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
    parts.push(<span key={match.index} className={tokenClass}>{token}</span>)
    lastIndex = match.index + token.length
  }

  if (lastIndex < code.length) {
    parts.push(code.slice(lastIndex))
  }
  return parts
}

export type DiffViewerProps = {
  path: string
  diff: string
}

export const DiffViewer = memo(function DiffViewer({ path, diff }: DiffViewerProps): JSX.Element {
  const [copied, setCopied] = useState(false)
  const parsed = useMemo(() => parseUnifiedDiff(diff), [diff])

  function copyDiff(): void {
    void navigator.clipboard.writeText(diff)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function openFile(): void {
    const href = path.startsWith('file://') ? path : `file://${path.startsWith('/') ? '' : '/'}${path}`
    void window.closedai.localFiles.open(href)
  }

  return (
    <div className="activity-card-diff-container">
      <header className="diff-header">
        <div className="diff-header-title">
          <FileCode className="diff-header-icon" aria-hidden="true" />
          <button
            type="button"
            className="diff-header-path"
            data-ui="chat.local-file"
            data-ui-key={path}
            onClick={openFile}
            title={`Reveal ${path} in workspace`}
          >
            {path}
          </button>
        </div>
        <div className="diff-header-actions">
          {parsed.additions > 0 && <span className="diff-stat-add">+{parsed.additions}</span>}
          {parsed.deletions > 0 && <span className="diff-stat-del">-{parsed.deletions}</span>}
          <button
            type="button"
            className="diff-copy-btn"
            onClick={copyDiff}
            title={copied ? 'Copied to clipboard' : 'Copy diff to clipboard'}
          >
            {copied ? <Check className="diff-btn-icon" aria-hidden="true" /> : <Copy className="diff-btn-icon" aria-hidden="true" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </header>

      <div className="diff-table" role="region" aria-label={`Diff for ${path}`}>
        {parsed.hunks.map((hunk, hunkIdx) => (
          <div key={hunkIdx} className="diff-hunk-block">
            {hunk.header ? (
              <div className="diff-row diff-row-hunk">
                <span className="diff-gutter diff-gutter-old" aria-hidden="true">...</span>
                <span className="diff-gutter diff-gutter-new" aria-hidden="true">...</span>
                <span className="diff-gutter diff-gutter-sign" aria-hidden="true"> </span>
                <span className="diff-code diff-hunk-header">{hunk.header}</span>
              </div>
            ) : null}
            {hunk.lines.map((line, lineIdx) => (
              <div key={lineIdx} className={`diff-row diff-row-${line.kind}`}>
                <span className="diff-gutter diff-gutter-old" aria-hidden="true">
                  {line.oldNum !== null ? line.oldNum : ''}
                </span>
                <span className="diff-gutter diff-gutter-new" aria-hidden="true">
                  {line.newNum !== null ? line.newNum : ''}
                </span>
                <span className="diff-gutter diff-gutter-sign" aria-hidden="true">
                  {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
                </span>
                <span className="diff-code">
                  {line.kind === 'meta' ? line.text : highlightTokens(line.text)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
})
